// An addon that is not context-aware: NODE_MODULE() registers it only when
// the process loads it for the first time. test/run.mjs builds it.
#include <node.h>

namespace {

void Init(v8::Local<v8::Object>, v8::Local<v8::Value>, void*) {}

}  // namespace

NODE_MODULE(NODE_GYP_MODULE_NAME, Init)
