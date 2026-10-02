import { authClient } from "../auth.ts";
import { Avatar, EyeIcon, GearIcon, SignOutIcon, UserIcon } from "../icons.tsx";
import { useDevicePrefs } from "../lib/device-prefs.ts";
import { Menu, MenuBlock, MenuItem, MenuSwitch, MenuWho } from "../ui/menu.tsx";
import { Segmented } from "../ui/segmented.tsx";

/** The avatar menu: who is signed in, appearance, Hide Details, Settings, Account and Sign Out. */
export function AccountMenu(props: {
  readonly name: string;
  readonly onSettings: () => void;
  readonly onAccount: () => void;
}) {
  const prefs = useDevicePrefs();
  return (
    <Menu label="Account Menu" trigger={<Avatar />} triggerClassName="avatar">
      <MenuWho lead="Signed in as" name={props.name} />
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
      <MenuSwitch
        icon={<EyeIcon />}
        checked={prefs.privacy}
        onChange={(hidden) => prefs.setPrivacy(hidden)}
      >
        Hide Details
      </MenuSwitch>
      <MenuItem icon={<GearIcon />} onSelect={props.onSettings}>
        Settings
      </MenuItem>
      <MenuItem icon={<UserIcon />} onSelect={props.onAccount}>
        Account
      </MenuItem>
      <MenuItem icon={<SignOutIcon />} danger onSelect={() => void authClient.signOut()}>
        Sign Out
      </MenuItem>
    </Menu>
  );
}
