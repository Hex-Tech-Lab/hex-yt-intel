# Legacy WebGL Animation Archive
**Date**: 2026-06-10
**Type**: Landing Page Animation (Full Screen Data Points)

## Overview
This directory contains the source code for the WebGL/Three.js "Data Points" particle animation that was previously used on the landing page before the implementation of the strict 10X Design System replication.

## Files
- `landing-page-legacy.tsx`: The full previous state of `web/app/landing-page.tsx` including the hero section logic.
- `LandingThree.tsx`: The standalone Three.js component that renders the animated particles.

## Usage
To restore or reuse this animation:
1. Re-import `LandingThree` into any page component.
2. Ensure `three` and `@react-three/fiber` dependencies are present in `package.json`.
3. Wrap the component in a `relative` container with a lower `z-index` than your content.
