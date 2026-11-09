// Creates and frees extra Node.js Environments in the current isolate and
// event loop. Each Environment is restored from the process's startup
// snapshot (CreateEnvironment() with an empty context). Uses only the public
// embedder API in node.h, so it needs a build per Node.js ABI version.

#include <node.h>
#include <uv.h>
#include <v8.h>

#include <string>
#include <string_view>
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
  node::Environment* env = node::CreateEnvironment(
      isolate_data, Local<Context>(), ToStrings(isolate, args[1]),
      ToStrings(isolate, args[2]), flags);
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

// load(id, source): runs pre-execution and an embedder main script.
void Load(const FunctionCallbackInfo<Value>& args) {
  node::Environment* env = GetEnv(args);
  if (env == nullptr) return;
  Isolate* isolate = args.GetIsolate();
  String::Utf8Value source(isolate, args[1]);
  // LoadEnvironment() checks that the current context belongs to `env`.
  Context::Scope context_scope(node::GetMainContext(env));
  MaybeLocal<Value> result = node::LoadEnvironment(
      env, std::string_view(*source, source.length()));
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

// free(id)
void Free(const FunctionCallbackInfo<Value>& args) {
  node::Environment* env = GetEnv(args);
  if (env == nullptr) return;
  node::FreeEnvironment(env);
  envs[args[0].As<v8::Uint32>()->Value()] = nullptr;
}

}  // namespace

NODE_MODULE_INIT(/* exports, module, context */) {
  NODE_SET_METHOD(exports, "create", Create);
  NODE_SET_METHOD(exports, "load", Load);
  NODE_SET_METHOD(exports, "call", Call);
  NODE_SET_METHOD(exports, "global", Global);
  NODE_SET_METHOD(exports, "free", Free);
}
