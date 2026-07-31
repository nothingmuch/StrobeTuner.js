# End-to-end check in a real NixOS machine: nginx serves the page over
# http://localhost (a secure context, which the AudioWorklet and getUserMedia
# both require) and Playwright drives a headless Chromium against it.
#
# The point of a VM rather than a devshell is that the machine is complete.
# There is a /bin/sh, a writable home, a tmpfs, and a real service manager, so
# the test cannot silently depend on whatever the developer's sandbox happens
# to provide.

{ pkgs, self }:

let
  tone = pkgs.runCommand "tone.wav" { } ''
    cp ${self}/test/gen-tone.mjs gen-tone.mjs
    ${pkgs.nodejs}/bin/node gen-tone.mjs 110 30
    mv tone.wav "$out"
  '';

  site = pkgs.runCommand "strobetuner-site" { } ''
    mkdir -p $out
    cp ${self}/index.html ${self}/tuner.js ${self}/strobe-processor.js $out/
  '';

  suite = pkgs.runCommand "strobetuner-suite" { } ''
    mkdir -p $out/test
    cp ${self}/playwright.config.mjs $out/
    cp ${self}/test/*.spec.mjs $out/test/
    ln -s ${pkgs.playwright-test}/lib/node_modules $out/node_modules
  '';
in

pkgs.testers.runNixOSTest {
  name = "strobetuner";

  nodes.machine = { ... }: {
    virtualisation.memorySize = 4096;
    virtualisation.diskSize = 4096;

    services.nginx = {
      enable = true;
      virtualHosts."localhost".root = site;
    };

    environment.systemPackages = [ pkgs.nodejs pkgs.playwright-test ];

    environment.variables = {
      PLAYWRIGHT_BROWSERS_PATH = pkgs.playwright-driver.browsers;
      PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";
    };
  };

  testScript = ''
    machine.wait_for_unit("nginx.service")
    machine.wait_for_open_port(80)

    # The page must be served before the browser is worth starting.
    machine.succeed("curl -sSf http://localhost/ | grep -q canvas")
    machine.succeed("curl -sSf http://localhost/strobe-processor.js >/dev/null")

    print(machine.succeed(
        "cd ${suite} && "
        "BASE_URL=http://localhost "
        "TONE_WAV=${tone} "
        "CHROMIUM_NO_SANDBOX=1 "
        "HOME=/tmp "
        # cwd is the read-only store, so artifacts go to the tmpfs.
        "npx playwright test --output=/tmp/test-results 2>&1"
    ))
  '';
}
