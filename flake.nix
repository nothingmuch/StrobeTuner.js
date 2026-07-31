{
  description = "StrobeTuner.js: AudioWorklet strobe tuner, with a NixOS VM browser test";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in {
      devShells = forAll (pkgs: {
        default = pkgs.mkShell {
          packages = [ pkgs.nodejs pkgs.playwright-test ];

          env = {
            PLAYWRIGHT_BROWSERS_PATH = pkgs.playwright-driver.browsers;
            PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";
            PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
          };

          # ESM resolution only walks up node_modules directories from the
          # importing file, so NODE_PATH does not help. Link the store's copy
          # into the tree instead.
          shellHook = ''
            ln -sfn ${pkgs.playwright-test}/lib/node_modules node_modules
            [ -f test/tone.wav ] || node test/gen-tone.mjs 110 30
          '';
        };
      });

      # The VM test needs a NixOS guest, so it is Linux only.
      checks = nixpkgs.lib.genAttrs [ "x86_64-linux" "aarch64-linux" ] (system: {
        vm = import ./test/vm.nix {
          pkgs = nixpkgs.legacyPackages.${system};
          inherit self;
        };
      });
    };
}
