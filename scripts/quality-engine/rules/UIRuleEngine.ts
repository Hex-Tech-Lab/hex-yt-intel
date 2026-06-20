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

export function registerUIRules(engine: any) {
  engine.addRule(InpAlertBlockerRule);
  engine.addRule(CanvasHoverReRenderRule);
  engine.addRule(OverlayCloseCascadeRule);
  engine.addRule(ValidationOnChangeRule);
  engine.addRule(UnhandledClipboardPromiseRule);
  engine.addRule(StartTransitionWrappingRule);
  engine.addRule(ToastAccessibilityRule);
  engine.addRule(SwallowedErrorRule);
  engine.addRule(SyncImportBeforeRedirectRule);
  engine.addRule(CanvasStaleDataRule);
}
