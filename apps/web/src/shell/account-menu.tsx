import { authClient } from "../auth.ts";
import { Avatar, GearIcon, SignOutIcon, UserIcon } from "../icons.tsx";
import { useDevicePrefs } from "../lib/device-prefs.ts";
import { Menu, MenuBlock, MenuItem, MenuSeparator, MenuWho } from "../ui/menu.tsx";
import { Segmented } from "../ui/segmented.tsx";

/**
 * The avatar menu, laid out as Arc's user menu: a header with the face and who is signed in, then groups of rows
 * (appearance; Settings and Account; Sign Out) with hairlines between them. Privacy Mode and Demo Mode live in
 * Settings, on their own tab.
 */
export function AccountMenu(props: {
  readonly name: string;
  readonly onSettings: () => void;
  readonly onAccount: () => void;
}) {
  const prefs = useDevicePrefs();
  return (
    <Menu
      label="Account Menu"
      trigger={<Avatar seed={props.name} />}
      triggerClassName="avatar"
      openOnHover
    >
      <MenuWho lead="Signed in as" name={props.name} face={<Avatar seed={props.name} />} />
      <MenuBlock>
        <Segmented
          full
          label="Appearance"
          value={prefs.appearance}
          onChange={(appearance) => prefs.setAppearance(appearance)}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </MenuBlock>
      <MenuSeparator />
      <MenuItem icon={<GearIcon />} onSelect={props.onSettings}>
        Settings
      </MenuItem>
      <MenuItem icon={<UserIcon />} onSelect={props.onAccount}>
        Account
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={<SignOutIcon />} danger onSelect={() => void authClient.signOut()}>
        Sign Out
      </MenuItem>
    </Menu>
  );
}
