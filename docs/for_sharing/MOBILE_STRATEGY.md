# Mobile Strategy: Expo vs React Native (Phase 2 Decision)
**Question**: Should we use Expo or React Native?
**Answer**: START with Expo for MVP. It's 80% faster, handles iOS + Android from one codebase, and we can migrate to React Native CLI later if needed.
---
## QUICK COMPARISON
| Aspect | React Native CLI | Expo | Winner |
|---|---|---|---|
| **Setup Time** | 2–3 hours | 15 minutes | ✅ Expo |
| **Development Speed** | Slower | Fast (JS-only) | ✅ Expo |
| **Deployment** | Manual builds | EAS Build (1 command) | ✅ Expo |
| **iOS Support** | Needs Xcode + Mac | Works from any OS | ✅ Expo |
| **Native Modules** | Full access | Limited | ⚠️ React Native |
| **Customization** | Unlimited | ~95% of use cases | ⚠️ React Native |
| **Code Sharing** | Can share logic | Can share logic + UI | ✅ Expo |
| **App Size** | Smaller (~40 MB) | Larger (~100 MB) | ⚠️ React Native |
| **MVP Suitable** | Yes | Yes, faster | ✅ Expo |
---
## DECISION FOR HEX-DIVA
✅ **Use Expo for MVP + Phase 2**
- Fastest to market (web + mobile together)
- Same codebase (shared utils, hooks, types)
- Deploy to App Store + Play Store in hours
- Can eject later if needed
✅ **Defer iOS/Android to Phase 2**
- Focus on web MVP this week
- Mobile doesn't block web
- Code structure ready for Expo NOW
✅ **Monorepo Structure**
hex-diva/
├── web/ # Next.js 16.2.6
├── mobile/ # Expo (iOS + Android)
└── shared/ # npm package (utils, hooks, types)

---
## WORKFLOW
### Step 1: Initialize (15 min)
```bash
npx create-expo-app hex-diva-mobile
cd hex-diva-mobile
npm install
npm start
Step 2: Develop
npm start
# Scan QR code with Expo Go app
# Code changes auto-reload
Step 3: Build & Deploy
npm install -g eas-cli
eas build --platform ios
eas build --platform android
eas submit --platform ios
eas submit --platform android
Status: ✅ DECIDED. Expo for Phase 2 mobile. Web focuses this week.
