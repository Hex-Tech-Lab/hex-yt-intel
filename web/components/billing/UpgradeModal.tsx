'use client';

import { PricingModal, type PricingModalProps } from './PricingModal';

export type UpgradeModalProps = PricingModalProps;

export function UpgradeModal(props: UpgradeModalProps) {
  return <PricingModal {...props} />;
}

export default UpgradeModal;
