import type { ComputerAccess, ComputerMode } from "@savingroup/contracts";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { useI18n } from "../lib/i18n";
import { native, useMobileTokens } from "../lib/native";
import { NativeSegmentedControl } from "./native-segmented-control";

export function ComputerModePicker({
  value,
  onChange,
  disabled = false,
  access,
  children,
}: {
  value: ComputerMode | undefined;
  onChange: (mode: ComputerMode) => void;
  disabled?: boolean;
  /** When set, the access choice leads, and Off hides the mode and `children`. */
  access?: { value: ComputerAccess; onChange: (access: ComputerAccess) => void };
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  return (
    <View style={{ marginTop: 16, padding: 16, borderRadius: 14, backgroundColor: native.fill }}>
      <Text style={{ color: tokens.foreground, marginBottom: 12, fontSize: 16, fontWeight: "600" }}>
        {t("Computer")}
      </Text>
      {access ? (
        <NativeSegmentedControl
          accessibilityLabel={t("Computer access")}
          onChange={access.onChange}
          options={[
            { value: "off", label: t("Off") },
            { value: "ask", label: t("Ask first") },
            { value: "full", label: t("Full") },
          ]}
          value={access.value}
        />
      ) : null}
      {access?.value === "off" ? null : (
        <>
          {access ? <View style={{ height: 12 }} /> : null}
          <NativeSegmentedControl
            accessibilityLabel={t("Computer")}
            disabled={disabled}
            onChange={onChange}
            options={[
              { value: "team", label: t("Team") },
              { value: "dedicated", label: t("Private") },
            ]}
            value={value}
          />
          {children}
        </>
      )}
    </View>
  );
}
