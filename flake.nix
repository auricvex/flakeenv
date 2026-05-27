{
  inputs = {
    flake-utils.url = "github:numtide/flake-utils";
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    inputs:
    inputs.flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = (import (inputs.nixpkgs) { inherit system; });
      in
      {
        devShell = pkgs.mkShell {
          nativeBuildInputs = [
            pkgs.pnpm
            pkgs.typescript
            pkgs.typescript-language-server
            pkgs.nodejs
          ];

          shellHook = ''
            if [ -z "$NIX_FISH_SHELL" ]; then
              export NIX_FISH_SHELL=1
              case "$-" in
                *i*) exec ${pkgs.fish}/bin/fish ;;
              esac
            fi
          '';
        };
      }
    );
}
