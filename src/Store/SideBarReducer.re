/*
 * SideBarReducer.re
 */

open Oni_Core;
open Oni_Model;
open Actions;

let reduce = (~zenMode, state: SideBar.t, action: Actions.t) => {
  switch (action) {
  // When we're in Zen mode, we ignore toggling, and exit zen mode
  | ActivityBar(ActivityBar.FileExplorerClick) when !zenMode =>
    SideBar.toggle(SideBar.FileExplorer, state)
  | ActivityBar(ActivityBar.SCMClick) when !zenMode =>
    SideBar.toggle(SideBar.SCM, state)
  | ActivityBar(ActivityBar.ExtensionsClick) when !zenMode =>
    SideBar.toggle(SideBar.Extensions, state)
  | ConfigurationSet(newConfig) =>
    let sideBarSetting =
      Configuration.getValue(c => c.workbenchSideBarVisible, newConfig);
    SideBar.setDefaultVisibility(state, sideBarSetting);
  | _ => state
  };
};
