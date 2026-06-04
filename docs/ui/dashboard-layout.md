# Dashboard Layout

The `DashboardLayout` provides the structural grid for the application.

## Layout Components
- **Sidebar**: Left-side navigation, fixed width (260px).
- **Topbar**: Header with search and account controls.
- **Main**: Content area with scrolling behavior and auto-centering (max-width 1200px).
- **RightPanel**: Optional right-side intelligence rail, fixed width (390px).
- **Dock**: Bottom-anchored component, typically used for the `ChatDock`.

## Implementation Details
- Uses CSS Grid for the primary three-column structure.
- Responsive breakpoints ensure usable min-width (1024px).
- Incorporates backdrop blur and sticky positioning for modern aesthetic.
