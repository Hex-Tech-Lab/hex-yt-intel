import {
  InpAlertBlockerRule,
  CanvasHoverReRenderRule,
  OverlayCloseCascadeRule,
  ValidationOnChangeRule,
  UnhandledClipboardPromiseRule,
  StartTransitionWrappingRule,
  ToastAccessibilityRule,
  SwallowedErrorRule,
  SyncImportBeforeRedirectRule,
  CanvasStaleDataRule
} from "./ui";

export function registerUIRules(engine: unknown) {
  const e = engine as any;
  e.addRule(InpAlertBlockerRule);
  e.addRule(CanvasHoverReRenderRule);
  e.addRule(OverlayCloseCascadeRule);
  e.addRule(ValidationOnChangeRule);
  e.addRule(UnhandledClipboardPromiseRule);
  e.addRule(StartTransitionWrappingRule);
  e.addRule(ToastAccessibilityRule);
  e.addRule(SwallowedErrorRule);
  e.addRule(SyncImportBeforeRedirectRule);
  e.addRule(CanvasStaleDataRule);
}
