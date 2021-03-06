/*
 * PreflightChecks.re
 *
 * This establishes and verifies a set of invariants to ensure the environment
 * is set up correctly for the application to run.
 */

open Oni_Core;

let checkUserDataDirectoryOrThrow = () => {
  let _ = Filesystem.getUserDataDirectoryExn();
  ();
};

let run = () => {
  checkUserDataDirectoryOrThrow();
};
