// Creates and frees extra Node.js Environments in the current isolate and
// event loop. Each Environment is restored from the process's startup
// snapshot (CreateEnvironment() with an empty context). Uses only the public
// embedder API in node.h, so it needs a build per Node.js ABI version.

#include <node.h>
#include <uv.h>
#include <v8.h>

#include <cstdint>
#include <memory>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace {

using v8::Array;
using v8::Context;
using v8::FunctionCallbackInfo;
using v8::Isolate;
using v8::Local;
using v8::MaybeLocal;
using v8::Object;
using v8::String;
using v8::Value;

std::vector<node::Environment*> envs;

node::Environment* GetEnv(const FunctionCallbackInfo<Value>& args) {
  uint32_t id = args[0].As<v8::Uint32>()->Value();
  if (id >= envs.size() || envs[id] == nullptr) return nullptr;
  return envs[id];
}

std::vector<std::string> ToStrings(Isolate* isolate, Local<Value> value) {
  std::vector<std::string> result;
  if (!value->IsArray()) return result;
  Local<Context> context = isolate->GetCurrentContext();
  Local<Array> array = value.As<Array>();
  for (uint32_t i = 0; i < array->Length(); i++) {
    Local<Value> item;
    if (!array->Get(context, i).ToLocal(&item)) continue;
    String::Utf8Value str(isolate, item);
    result.emplace_back(*str, str.length());
  }
  return result;
}

// create(flags, args, execArgs) -> id
void Create(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> host_context = isolate->GetCurrentContext();
  node::Environment* host = node::GetCurrentEnvironment(host_context);
  node::IsolateData* isolate_data = node::GetEnvironmentIsolateData(host);
  auto flags = static_cast<node::EnvironmentFlags::Flags>(
      args[0].As<v8::Uint32>()->Value());
  // Thread id 0, as in a fork (worker_threads.threadId). Node.js uses the id
  // only for the names of diagnostic files and in the inspector.
  node::Environment* env = node::CreateEnvironment(isolate_data,
                                                   Local<Context>(),
                                                   ToStrings(isolate, args[1]),
                                                   ToStrings(isolate, args[2]),
                                                   flags,
                                                   node::ThreadId{0});
  if (env == nullptr) {
    isolate->ThrowError(
        String::NewFromUtf8Literal(isolate, "CreateEnvironment failed"));
    return;
  }
  // Let the host read and write the new Environment's global object.
  node::GetMainContext(env)->SetSecurityToken(host_context->GetSecurityToken());
  envs.push_back(env);
  args.GetReturnValue().Set(static_cast<uint32_t>(envs.size() - 1));
}

void EnterLater(Isolate* isolate, node::Environment* env);

// load(id, source): runs pre-execution and an embedder main script.
void Load(const FunctionCallbackInfo<Value>& args) {
  node::Environment* env = GetEnv(args);
  if (env == nullptr) return;
  Isolate* isolate = args.GetIsolate();
  String::Utf8Value source(isolate, args[1]);
  MaybeLocal<Value> result;
  {
    // LoadEnvironment() checks that the current context belongs to `env`.
    Context::Scope context_scope(node::GetMainContext(env));
    result =
        node::LoadEnvironment(env, std::string_view(*source, source.length()));
  }
  EnterLater(isolate, env);
  Local<Value> value;
  if (result.ToLocal(&value)) args.GetReturnValue().Set(value);
}

// call(id, fn, arg): calls fn(arg) inside a callback scope of the
// Environment, so its nextTick and microtask queues run afterwards.
void Call(const FunctionCallbackInfo<Value>& args) {
  node::Environment* env = GetEnv(args);
  if (env == nullptr) return;
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = node::GetMainContext(env);
  Context::Scope context_scope(context);
  Local<Value> value;
  {
    Local<Object> resource = Object::New(isolate);
    node::CallbackScope callback_scope(env, resource, {0, 0});
    Local<Value> argv[] = {args[2]};
    if (!args[1]
             .As<v8::Function>()
             ->Call(context, v8::Undefined(isolate), 1, argv)
             .ToLocal(&value)) {
      return;
    }
  }
  args.GetReturnValue().Set(value);
}

void Global(const FunctionCallbackInfo<Value>& args) {
  node::Environment* env = GetEnv(args);
  if (env == nullptr) return;
  args.GetReturnValue().Set(node::GetMainContext(env)->Global());
}

// The contexts of freed Environments, until the GC collects them. Never
// deleted: at a normal exit, Node.js disposes the isolate before C++ destroys
// global objects, and a v8::Global must not be destroyed after its isolate is
// disposed.
struct FreedContext {
  v8::Global<Context> context;
  // The number of young-generation GCs before the Environment was freed.
  uint64_t young_gcs_at_free;
};
std::vector<FreedContext>& freed_contexts = *new std::vector<FreedContext>();

// The number of young-generation GCs so far. See OnGCEpilogue().
uint64_t young_gc_count = 0;

// A young-generation GC can find dead objects only in the young generation.
// An object moves to the old generation when it survives its second
// young-generation GC. So if no JavaScript runs in a context after its
// Environment is freed, the context has no young objects after two more
// young-generation GCs. Check one more GC than that, in case V8 could not
// move an object.
//
// This does not cover two cases. If code of a later file adds a target to a
// registry of a freed file (the pool gives a file no way to get objects of an
// earlier file, but a native addon could), the GC can find the target dead
// after these GCs. And the list has only the main context of each
// Environment, not the contexts that the file made with node:vm.
constexpr uint64_t kYoungGCsWithYoungObjects = 3;

// Tells V8 that the context goes away, as a browser does for a page. V8 then
// drops the maps that it keeps alive for the context (without this, a normal
// full GC does not collect the context) and the pending FinalizationRegistry
// callbacks of the context. Such a callback would run in a freed Environment
// and abort the process.
void DisposeContext(Isolate* isolate, Local<Context> context) {
  Context::Scope context_scope(context);
  isolate->ContextDisposedNotification(v8::ContextDependants::kSomeDependants);
}

// Drops the queued FinalizationRegistry callbacks of the freed contexts that
// the GC did not collect yet. If only_young is true, it drops only the
// callbacks of the contexts that can still have objects in the young
// generation.
void DisposeFreedContexts(Isolate* isolate, bool only_young) {
  v8::HandleScope handle_scope(isolate);
  std::erase_if(freed_contexts,
                [](const FreedContext& c) { return c.context.IsEmpty(); });
  for (const FreedContext& freed : freed_contexts) {
    if (only_young &&
        young_gc_count - freed.young_gcs_at_free > kYoungGCsWithYoungObjects) {
      continue;
    }
    DisposeContext(isolate, freed.context.Get(isolate));
  }
}

// A freed context lives until a full GC collects it, and so do its
// FinalizationRegistries. A GC before that can find dead objects of the
// context and queue the callbacks of its registries. V8 runs these callbacks
// in a task, with the freed context as the current context, and Node.js
// finds no Environment for that context. If a callback calls into Node.js,
// the process crashes with SIGSEGV. For example, the registry of
// AbortSignal.timeout() calls clearTimeout(), which calls into Node.js if an
// async_hooks destroy hook is enabled (node:test enables one). So drop the
// queued callbacks after the GC, before the task runs.
//
// Each drop also flushes the queues of the concurrent optimizing compilers,
// and posts a task that can start another young-generation GC (see
// Isolate::ContextDisposedNotification()). So after a young-generation GC,
// drop only the callbacks of the contexts that can have young objects. This
// also ends the chain of GCs that the tasks start.
void OnGCEpilogue(Isolate* isolate,
                  v8::GCType type,
                  v8::GCCallbackFlags,
                  void*) {
  const bool young = type != v8::kGCTypeMarkSweepCompact;
  if (young) young_gc_count++;
  if (!freed_contexts.empty()) DisposeFreedContexts(isolate, young);
}

// Call this only outside uv_run() (see Deferred below).
void FreeNow(Isolate* isolate, node::Environment* env) {
  // FreeEnvironment() below can run queued tasks, such as these callbacks.
  // Drop them first.
  DisposeFreedContexts(isolate, false);
  {
    v8::HandleScope handle_scope(isolate);
    Local<Context> context = node::GetMainContext(env);
    DisposeContext(isolate, context);
    freed_contexts.push_back(
        {v8::Global<Context>(isolate, context), young_gc_count});
    freed_contexts.back().context.SetWeak();
  }
  node::FreeEnvironment(env);
}

struct PendingFree {
  node::Environment* env;
  v8::Global<v8::Function> done;
};

// FreeEnvironment() runs the event loop: CleanupHandles() calls uv_run() until
// the handles and requests of the Environment are done. The host asks for a
// free in an event loop callback, and libuv does not allow uv_run() in a
// callback of the same loop. The outer uv_run() can hold a batch of callbacks
// that it took off the loop, for example thread pool completions, or on
// Windows all completions. The inner uv_run() does not see that batch, so
// CleanupHandles() can wait forever.
//
// So free() only queues the Environment. The Environment is freed after
// uv_run() returns:
// 1. A one-shot uv_check callback calls uv_stop() and posts a foreground task.
//    Node.js runs posted tasks from a uv_async_t callback, so only in the poll
//    phase. After the check phase, uv_run() does not poll again, so the task
//    does not run in this uv_run().
// 2. uv_run() returns at the end of this loop iteration. Node.js then runs the
//    task from DrainTasks(), before it calls uv_run() again
//    (SpinEventLoopInternal() in src/api/embed_helpers.cc).
// 3. The task frees the queued Environments and calls their done callbacks.
//
// The same uv_check callback also enters the context of the last loaded
// Environment, and the task exits it before the free. Node.js expects that, in
// a callback of the event loop, the current context belongs to the
// Environment of the callback, because a process has one Environment per
// loop. Here the host's context would be current. Then some Node.js code
// aborts the process (the read of a Blob from fs.openAsBlob(), or
// napi_make_callback() of an addon), and a V8 platform task runs the nextTick
// queue of the host, not of the test file. Callbacks of the host itself then
// run with the context of the test file, so the host uses only callbacks in
// which Node.js enters the host's context, such as IPC, timers, and
// setImmediate().
//
// Context::Enter() and Exit() must be last in, first out. OnCheck() and the
// task call them with only the host's context and the entered context below.
// So the event loop of the host must not end while a context is entered. The
// host exits with process.exit() or a signal.
struct Deferred {
  uv_loop_t* loop;
  std::shared_ptr<v8::TaskRunner> runner;
  // The handles are never closed. They keep the loop alive only until
  // OnCheck() runs.
  uv_idle_t idle;
  uv_check_t check;
  std::vector<PendingFree> queue;
  bool draining = false;
  node::Environment* entered = nullptr;
  node::Environment* to_enter = nullptr;
};

// One per process. Never deleted: the loop keeps pointers to its handles.
Deferred* deferred = nullptr;

Deferred* GetDeferred(Isolate* isolate) {
  if (deferred != nullptr) return deferred;
  deferred = new Deferred();
  deferred->loop = node::GetCurrentEventLoop(isolate);
  node::Environment* host =
      node::GetCurrentEnvironment(isolate->GetCurrentContext());
  deferred->runner =
      node::GetMultiIsolatePlatform(host)->GetForegroundTaskRunner(isolate);
  uv_idle_init(deferred->loop, &deferred->idle);
  uv_check_init(deferred->loop, &deferred->check);
  // Scavenges and mark-compact GCs can queue FinalizationRegistry callbacks.
  // Minor mark-sweep GCs (--minor-ms) do not in Node.js 26, but the callback
  // also counts them as young-generation GCs, in case a later V8 does.
  isolate->AddGCEpilogueCallback(
      OnGCEpilogue,
      nullptr,
      static_cast<v8::GCType>(v8::kGCTypeScavenge | v8::kGCTypeMinorMarkSweep |
                              v8::kGCTypeMarkSweepCompact));
  return deferred;
}

class FreeTask : public v8::Task {
 public:
  void Run() override;
};

void OnCheck(uv_check_t*) {
  Deferred* d = deferred;
  // A uv_run() inside FreeEnvironment(): the context of the Environment that
  // is being freed is entered above. Wait for the outer uv_run().
  if (d->draining) return;
  uv_idle_stop(&d->idle);
  uv_check_stop(&d->check);
  if (d->to_enter != nullptr) {
    v8::HandleScope scope(Isolate::GetCurrent());
    // The pool loads an Environment only after the one before is freed. If
    // not, the one before would stay alive without its context entered.
    if (d->entered != nullptr) node::GetMainContext(d->entered)->Exit();
    node::GetMainContext(d->to_enter)->Enter();
    d->entered = std::exchange(d->to_enter, nullptr);
  }
  if (d->queue.empty()) return;
  uv_stop(d->loop);
  d->runner->PostTask(std::make_unique<FreeTask>());
}

// The idle handle keeps the poll phase from blocking. So if this runs after
// the check phase, the next check phase comes without a wait for I/O. Both
// calls do nothing if the handle is already active.
void Arm(Deferred* d) {
  uv_idle_start(&d->idle, [](uv_idle_t*) {});
  uv_check_start(&d->check, OnCheck);
}

void EnterLater(Isolate* isolate, node::Environment* env) {
  Deferred* d = GetDeferred(isolate);
  d->to_enter = env;
  Arm(d);
}

void FreeTask::Run() {
  Deferred* d = deferred;
  // FreeEnvironment() runs uv_run(), which can run another FreeTask. The loop
  // below also frees the Environments that are queued in the meantime.
  if (d->draining) return;
  Isolate* isolate = Isolate::GetCurrent();
  // Node.js runs this task in a callback scope of the Environment of the
  // current context, and uses that Environment after the task. So exit the
  // context here, and free in a new task. DrainTasks() runs that task before
  // it returns, with the host's context.
  if (d->entered != nullptr) {
    v8::HandleScope scope(isolate);
    node::GetMainContext(d->entered)->Exit();
    d->entered = nullptr;
    d->runner->PostTask(std::make_unique<FreeTask>());
    return;
  }
  d->draining = true;
  while (!d->queue.empty()) {
    PendingFree pending = std::move(d->queue.front());
    d->queue.erase(d->queue.begin());
    FreeNow(isolate, pending.env);
    v8::HandleScope scope(isolate);
    Local<v8::Function> done = pending.done.Get(isolate);
    // An exception in done() is an uncaught exception of the host.
    (void)node::MakeCallback(isolate,
                             done->GetCreationContextChecked(isolate)->Global(),
                             done,
                             0,
                             nullptr,
                             {0, 0});
  }
  d->draining = false;
}

// free(id, done): queues the Environment, frees it after uv_run() returns (see
// Deferred), and then calls done(). Does nothing for an id that is not live.
void Free(const FunctionCallbackInfo<Value>& args) {
  node::Environment* env = GetEnv(args);
  if (env == nullptr) return;
  Isolate* isolate = args.GetIsolate();
  if (!args[1]->IsFunction()) {
    isolate->ThrowError(
        String::NewFromUtf8Literal(isolate, "free() needs a done callback"));
    return;
  }
  Deferred* d = GetDeferred(isolate);
  envs[args[0].As<v8::Uint32>()->Value()] = nullptr;
  if (d->to_enter == env) d->to_enter = nullptr;
  // The Environment can still run callbacks until it is freed. A fork can
  // also run callbacks until it exits. Do not call node::Stop() here to block
  // them: with node::Stop(), a stress test that freed many Environments in a
  // row crashed in V8's concurrent marking. The cause is not known.
  d->queue.push_back(
      {env, v8::Global<v8::Function>(isolate, args[1].As<v8::Function>())});
  // FreeTask::Run() also frees the Environments that are queued while it runs.
  if (d->draining) return;
  Arm(d);
}

}  // namespace

NODE_MODULE_INIT(/* exports, module, context */) {
  NODE_SET_METHOD(exports, "create", Create);
  NODE_SET_METHOD(exports, "load", Load);
  NODE_SET_METHOD(exports, "call", Call);
  NODE_SET_METHOD(exports, "global", Global);
  NODE_SET_METHOD(exports, "free", Free);
}
