{
  "targets": [
    {
      "target_name": "legacy",
      "sources": ["legacy.cc"],
      "cflags_cc": ["-std=c++20"],
      "xcode_settings": {
        "CLANG_CXX_LANGUAGE_STANDARD": "c++20"
      },
      "msvs_settings": {
        "VCCLCompilerTool": {
          "AdditionalOptions": ["/std:c++20"]
        }
      }
    }
  ]
}
