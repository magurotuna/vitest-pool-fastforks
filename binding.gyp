{
  "targets": [
    {
      "target_name": "fastforks",
      "sources": ["addon/fastforks.cc"],
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
