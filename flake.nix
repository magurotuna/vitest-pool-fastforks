{
  description = "Development environment for vitest-pool-fastforks";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { nixpkgs, ... }:
    let
      forAllSystems = nixpkgs.lib.genAttrs [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          # Node.js 26.11 or later runs the pool. Python and the C++ compiler
          # of stdenv build the native addon with node-gyp. clang-tools has
          # clang-format for the addon. The vp command comes from the
          # vite-plus package in node_modules: run it with npm scripts or npx.
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_26
              pkgs.python3
              pkgs.clang-tools
            ];
          };
        }
      );
    };
}
