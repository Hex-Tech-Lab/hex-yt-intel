#!/usr/bin/env bash
set -eu

##############################################################################
# Blackbox CLI v2 Install Script (Extension Service Version)
#
# This script downloads and installs the Blackbox CLI v2 (Node.js-based)
# from the Extension Upload Service.
#
# Supported OS: macOS (darwin), Linux
# Supported Architectures: x86_64, arm64
#
# Usage:
#   curl -fsSL https://releases.blackbox.ai/api/scripts/blackbox-cli-v2/download.sh | bash
#
# Environment variables:
#   BLACKBOX_INSTALL_DIR  - Directory to install Blackbox CLI v2 (default: $HOME/.blackbox-cli-v2)
#   BLACKBOX_BIN_DIR      - Directory for the executable wrapper (default: $HOME/.local/bin)
#   EXTENSION_SERVICE_URL - Extension service URL (default: https://releases.blackbox.ai)
#   CONFIGURE             - Optional: if set to "false", disables running blackbox configure interactively
#   BLACKBOX_CLI_DEBUG    - Optional: if set to "true", shows verbose installation output
##############################################################################

# --- Debug mode setup ---
DEBUG="${BLACKBOX_CLI_DEBUG:-false}"

# Helper function for debug output (only shown when DEBUG=true)
debug_log() {
  if [ "$DEBUG" = "true" ]; then
    echo -e "$@"
  fi
}

# Helper function for normal output (always shown)
log() {
  echo -e "$@"
}

# Helper function to redirect output based on debug mode
redirect_output() {
  if [ "$DEBUG" = "true" ]; then
    cat
  else
    cat > /dev/null 2>&1
  fi
}

# Progress indicator variables
TOTAL_STEPS=9
CURRENT_STEP=0

# Helper function to show progress (single line, updates in place)
show_progress() {
  CURRENT_STEP=$((CURRENT_STEP + 1))
  local message="$1"
  local percentage=$((CURRENT_STEP * 100 / TOTAL_STEPS))

  # Create progress bar with block characters
  local bar_length=20
  local filled=$((bar_length * CURRENT_STEP / TOTAL_STEPS))
  local empty=$((bar_length - filled))
  local bar=""
  local i=0
  while [ $i -lt $filled ]; do bar="${bar}█"; i=$((i + 1)); done
  i=0
  while [ $i -lt $empty ]; do bar="${bar}░"; i=$((i + 1)); done

  # Clear line and print progress (use \r to return to start of line)
  printf "\r\033[K  ${bar} $percentage%% - $message"
}

# --- 1) Check for dependencies ---
show_progress "Checking dependencies"
debug_log "Checking dependencies..."

if ! command -v curl >/dev/null 2>&1; then
  echo "Error: 'curl' is required to download Blackbox CLI v2. Please install curl and try again."
  exit 1
fi

if ! command -v unzip >/dev/null 2>&1; then
  echo "Error: 'unzip' is required to extract Blackbox CLI v2. Please install unzip and try again."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Error: 'node' (Node.js) is required to run Blackbox CLI v2. Please install Node.js and try again."
  echo "Visit https://nodejs.org/ to download and install Node.js."
  exit 1
fi

# Check Node.js version (require v20 or higher)
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "Error: Node.js version 20 or higher is required. Current version: $(node -v)"
  echo "Please upgrade Node.js and try again."
  exit 1
fi

debug_log "All dependencies satisfied"

# --- 2) Variables ---
PRODUCT_SLUG="blackbox-cli-v2"
BLACKBOX_INSTALL_DIR="${BLACKBOX_INSTALL_DIR:-"$HOME/.blackbox-cli-v2"}"
BLACKBOX_BIN_DIR="${BLACKBOX_BIN_DIR:-"$HOME/.local/bin"}"
EXTENSION_SERVICE_URL="${EXTENSION_SERVICE_URL:-"https://releases.blackbox.ai"}"
CONFIGURE="${CONFIGURE:-false}"

# --- 3) Detect OS/Architecture ---
debug_log "Detecting platform..."
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS" in
  linux|darwin) ;;
  *)
    echo "Error: Unsupported OS '$OS'. Blackbox CLI v2 currently supports Linux and macOS."
    exit 1
    ;;
esac

case "$ARCH" in
  x86_64)
    ARCH="x86_64"
    ;;
  arm64|aarch64)
    ARCH="aarch64"
    ;;
  *)
    echo "Error: Unsupported architecture '$ARCH'."
    exit 1
    ;;
esac

# Map OS and ARCH to platform string
if [ "$OS" = "darwin" ]; then
  if [ "$ARCH" = "aarch64" ]; then
    PLATFORM="mac-arm64"
  else
    PLATFORM="mac-x64"
  fi
else
  # Linux
  if [ "$ARCH" = "aarch64" ]; then
    PLATFORM="linux-arm64"
  else
    PLATFORM="linux-x64"
  fi
fi

debug_log "Platform: $PLATFORM"

# --- 4) Get latest release information ---
show_progress "Fetching release information"
debug_log "Fetching latest release information for platform: $PLATFORM..."

RELEASE_API_URL="$EXTENSION_SERVICE_URL/api/v0/latest?product=$PRODUCT_SLUG&platform=$PLATFORM"

if [ "$DEBUG" = "true" ]; then
  if ! RELEASE_INFO=$(curl -sLf "$RELEASE_API_URL" 2>&1); then
    echo "Error: Failed to fetch release information from $RELEASE_API_URL"
    echo "Please check that the extension service is available and the product '$PRODUCT_SLUG' exists."
    exit 1
  fi
else
  if ! RELEASE_INFO=$(curl -sLf "$RELEASE_API_URL" 2>/dev/null); then
    echo "Error: Failed to fetch release information from $RELEASE_API_URL"
    echo "Please check that the extension service is available and the product '$PRODUCT_SLUG' exists."
    exit 1
  fi
fi

# Parse JSON response
DOWNLOAD_URL=$(echo "$RELEASE_INFO" | grep -o '"url":"[^"]*"' | cut -d'"' -f4)
VERSION=$(echo "$RELEASE_INFO" | grep -o '"version":"[^"]*"' | cut -d'"' -f4)

if [ -z "$DOWNLOAD_URL" ]; then
  echo "Error: Could not parse download URL from release information"
  echo "Release info: $RELEASE_INFO"
  exit 1
fi

# Ensure download URL is absolute
if [[ "$DOWNLOAD_URL" != http* ]]; then
  DOWNLOAD_URL="$EXTENSION_SERVICE_URL$DOWNLOAD_URL"
fi

debug_log "Downloading Blackbox CLI v2 version $VERSION from: $DOWNLOAD_URL"

# --- 5) Download the file ---
show_progress "Downloading package"
FILENAME=$(basename "$DOWNLOAD_URL")
if [ -z "$FILENAME" ] || [ "$FILENAME" = "/" ]; then
  FILENAME="blackbox-cli-v2-$PLATFORM.zip"
fi

if [ "$DEBUG" = "true" ]; then
  if ! curl -sLf "$DOWNLOAD_URL" --output "$FILENAME"; then
    echo "Error: Failed to download $DOWNLOAD_URL"
    exit 1
  fi
else
  if ! curl -sLf "$DOWNLOAD_URL" --output "$FILENAME" 2>/dev/null; then
    echo "Error: Failed to download $DOWNLOAD_URL"
    exit 1
  fi
fi

# --- 6) Remove existing installation if present ---
if [ -d "$BLACKBOX_INSTALL_DIR" ]; then
  debug_log "Removing existing installation at $BLACKBOX_INSTALL_DIR..."
  rm -rf "$BLACKBOX_INSTALL_DIR" 2>/dev/null || true
fi

# Remove old blackbox executables from bin directory
if [ -d "$BLACKBOX_BIN_DIR" ]; then
  debug_log "Removing old blackbox executables from $BLACKBOX_BIN_DIR..."
  rm -f "$BLACKBOX_BIN_DIR/blackbox" 2>/dev/null || true
  rm -f "$BLACKBOX_BIN_DIR/blackbox.mjs" 2>/dev/null || true
  rm -f "$BLACKBOX_BIN_DIR/blackbox.cmd" 2>/dev/null || true
fi

# --- 7) Create installation directory and extract ---
show_progress "Extracting package"
debug_log "Creating installation directory: $BLACKBOX_INSTALL_DIR"
mkdir -p "$BLACKBOX_INSTALL_DIR" 2>/dev/null || true

debug_log "Extracting $FILENAME..."
if [ "$DEBUG" = "true" ]; then
  if ! unzip -q "$FILENAME" -d "$BLACKBOX_INSTALL_DIR"; then
    echo "Error: Failed to extract $FILENAME"
    rm "$FILENAME"
    exit 1
  fi
else
  if ! unzip -q "$FILENAME" -d "$BLACKBOX_INSTALL_DIR" 2>/dev/null; then
    echo "Error: Failed to extract $FILENAME"
    rm "$FILENAME"
    exit 1
  fi
fi

rm "$FILENAME"

# --- 8) Verify installation structure ---
debug_log "Verifying installation structure..."
if [ ! -d "$BLACKBOX_INSTALL_DIR/packages/cli/dist" ]; then
  echo "Error: Invalid package structure. Expected packages/cli/dist directory not found."
  echo "Contents of $BLACKBOX_INSTALL_DIR:"
  ls -la "$BLACKBOX_INSTALL_DIR"
  exit 1
fi

# --- 8.5) Verify package.json files exist ---
debug_log "Verifying package metadata..."

# Function to get package name for a directory
get_package_name() {
  case "$1" in
    cli) echo "blackbox-cli" ;;
    core) echo "blackbox-cli-core" ;;
    test-utils) echo "blackbox-cli-test-utils" ;;
    vscode-ide-companion) echo "blackbox-cli-vscode-ide-companion" ;;
    *) echo "" ;;
  esac
}

# Verify package.json files exist (they should come from the extraction)
for pkg_dir in cli core test-utils vscode-ide-companion; do
  PKG_DIST="$BLACKBOX_INSTALL_DIR/packages/$pkg_dir/dist"
  if [ -d "$PKG_DIST" ] && [ -f "$PKG_DIST/package.json" ]; then
    pkg_name=$(get_package_name "$pkg_dir")
    debug_log "  Found package.json for @blackbox_ai/$pkg_name"
  else
    debug_log "  Warning: Missing package.json for $pkg_dir"
  fi
done

# --- 8.6) Fix package.json file paths ---
debug_log "Fixing package paths..."

CLI_PACKAGE_JSON="$BLACKBOX_INSTALL_DIR/packages/cli/dist/package.json"
if [ -f "$CLI_PACKAGE_JSON" ]; then
  # From /packages/cli/dist, we need to go ../../ to reach /packages/
  sed -i.bak 's|"file:\.\./core"|"file:../../core"|g' "$CLI_PACKAGE_JSON"
  sed -i.bak 's|"file:\.\./test-utils"|"file:../../test-utils"|g' "$CLI_PACKAGE_JSON"
  sed -i.bak 's|"file:\.\./vscode-ide-companion"|"file:../../vscode-ide-companion"|g' "$CLI_PACKAGE_JSON"
  rm -f "$CLI_PACKAGE_JSON.bak"
  debug_log "  Updated package.json file paths"
  
  # Add all required dependencies to CLI's package.json to ensure pnpm install --shamefully-hoist succeeds
  debug_log "Adding required dependencies to CLI package.json..."
  
  # Use Node.js to safely add dependencies to package.json
  node -e "
    const fs = require('fs');
    const pkgPath = '$CLI_PACKAGE_JSON';
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    
    // Ensure dependencies object exists
    if (!pkg.dependencies) pkg.dependencies = {};
    
    // Add all required dependencies
    const requiredDeps = {
      'mnemonist': '^0.40.3',
      'express': '^4.21.2',
      'openai': '5.11.0',
      'ajv': '^8.17.1',
      'ajv-formats': '^3.0.0',
      'chardet': '^2.1.0',
      'fast-uri': '^3.0.6',
      'fastest-levenshtein': '^1.0.16',
      'fdir': '^6.4.6',
      'form-data': '^4.0.4',
      'html-to-text': '^9.0.5',
      'https-proxy-agent': '^7.0.6',
      'ignore': '^7.0.0',
      'jose': '^5.10.0',
      'jsonrepair': '^3.13.0',
      'marked': '^15.0.12',
      'playwright': '^1.56.0',
      'sharp': '^0.33.5',
      'tiktoken': '^1.0.21',
      'uuid': '^9.0.1',
      'ws': '^8.18.0',
      'exceljs': '^4.4.0',
      'mammoth': '^1.8.0',
      'yaml': '^2.6.1',
      'picomatch': '^4.0.1',
      'glob': '^10.4.5',
      'react': '^19.1.0',
      'react-dom': '^19.1.0',
      'undici': '^7.10.0',
      '@lvce-editor/ripgrep': '^1.6.0',
      '@xterm/headless': '5.5.0',
      '@opentelemetry/api': '^1.9.0',
      '@opentelemetry/api-logs': '^0.208.0',
      '@opentelemetry/core': '^2.2.0',
      '@opentelemetry/exporter-logs-otlp-grpc': '^0.208.0',
      '@opentelemetry/exporter-logs-otlp-http': '^0.208.0',
      '@opentelemetry/exporter-metrics-otlp-grpc': '^0.208.0',
      '@opentelemetry/exporter-metrics-otlp-http': '^0.208.0',
      '@opentelemetry/exporter-trace-otlp-grpc': '^0.208.0',
      '@opentelemetry/exporter-trace-otlp-http': '^0.208.0',
      '@opentelemetry/instrumentation-http': '^0.208.0',
      '@opentelemetry/otlp-exporter-base': '^0.208.0',
      '@opentelemetry/resources': '^2.2.0',
      '@opentelemetry/sdk-logs': '^0.208.0',
      '@opentelemetry/sdk-metrics': '^2.2.0',
      '@opentelemetry/sdk-node': '^0.208.0',
      '@opentelemetry/sdk-trace-base': '^2.2.0',
      '@opentelemetry/sdk-trace-node': '^2.2.0',
      '@opentelemetry/semantic-conventions': '^1.38.0',
      'pg': '^8.13.1',
      'mongodb': '^6.12.0',
      'redis': '^4.7.0',
      'mysql2': '^3.11.5', 'chalk': '^5.3.0', 'ansi-escapes': '^7.0.0'
    };
    
    // Add missing dependencies
    let addedCount = 0;
    for (const [dep, version] of Object.entries(requiredDeps)) {
      if (!pkg.dependencies[dep]) {
        pkg.dependencies[dep] = version;
        addedCount++;
      }
    }

    if (!pkg.overrides) pkg.overrides = {};
    // Make the direct dependency safe
    pkg.dependencies['@modelcontextprotocol/sdk'] = '^1.25.2';

    // Force only the transitive copy used by server-github
    pkg.overrides['@modelcontextprotocol/server-github'] =
    pkg.overrides['@modelcontextprotocol/server-github'] || {};
    pkg.overrides['@modelcontextprotocol/server-github']['@modelcontextprotocol/sdk'] = '1.25.2';

    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    console.log('  Added ' + addedCount + ' missing dependencies');
  " 2>&1 | ([ "$DEBUG" = "true" ] && cat || grep -v "^$" > /dev/null)
  
  debug_log "  Dependencies updated in package.json"
fi

# --- 8.7) Create package.json files for local packages if missing ---
debug_log "Setting up local package metadata..."

for pkg_dir in core test-utils vscode-ide-companion; do
  PKG_DIST="$BLACKBOX_INSTALL_DIR/packages/$pkg_dir/dist"
  PKG_JSON="$PKG_DIST/package.json"
  
  if [ -d "$PKG_DIST" ] && [ ! -f "$PKG_JSON" ]; then
    pkg_name=$(get_package_name "$pkg_dir")
    debug_log "  Creating package.json for @blackbox_ai/$pkg_name"
    
    cat > "$PKG_JSON" << EOF
{
  "name": "@blackbox_ai/$pkg_name",
  "version": "$VERSION",
  "type": "module",
  "main": "index.js"
}
EOF
    
    if [ -f "$PKG_JSON" ]; then
      debug_log "    Created package.json for @blackbox_ai/$pkg_name"
    else
      debug_log "    Warning: Failed to create package.json for @blackbox_ai/$pkg_name"
    fi
  fi
done

# --- 8.8) Write VERSION file ---
debug_log "Writing version information..."
VERSION_FILE="$BLACKBOX_INSTALL_DIR/VERSION"
echo "$VERSION" > "$VERSION_FILE"
if [ -f "$VERSION_FILE" ]; then
  debug_log "  Version $VERSION written to $VERSION_FILE"
else
  debug_log "  Warning: Failed to write VERSION file"
fi

# --- 8.9) IMPROVED: Install dependencies with retry logic and fallbacks ---
show_progress "Installing dependencies"

# Function to install package dependencies with retry and fallback
install_package_deps() {
  local pkg_root=$1
  local pkg_name=$2
  local is_critical=$3
  local max_attempts=3
  local attempt=1
  
  # Check if package.json exists
  if [ ! -f "$pkg_root/package.json" ]; then
    if [ "$is_critical" = "true" ]; then
      echo "Error: Critical package.json not found for @blackbox_ai/$pkg_name"
      return 1
    else
      debug_log "  Skipping @blackbox_ai/$pkg_name (no package.json)"
      return 0
    fi
  fi
  
  cd "$pkg_root"
  
  while [ $attempt -le $max_attempts ]; do
    debug_log "  Installing dependencies for @blackbox_ai/$pkg_name (attempt $attempt/$max_attempts)..."
    
    # Determine which npm command to use
    local npm_cmd=""
    if [ -f "$pkg_root/package-lock.json" ]; then
      # Use pnpm install --shamefully-hoist if package-lock.json exists (faster and more reliable)
      npm_cmd="pnpm install --shamefully-hoist --prod --prefer-offline"
      debug_log "    Using pnpm install --shamefully-hoist (package-lock.json found)"
    else
      # Fallback to pnpm install --shamefully-hoist with optimizations
      npm_cmd="pnpm install --shamefully-hoist --prod --prefer-offline"
      debug_log "    Using pnpm install --shamefully-hoist (no package-lock.json)"
    fi
    
    # Capture pnpm install --shamefully-hoist output and exit code
    if [ "$DEBUG" = "true" ]; then
      if $npm_cmd   2>&1 | grep -v "^npm WARN deprecated" | grep -v "^npm WARN EBADENGINE" | grep -v "^npm WARN"; then
        debug_log "    @blackbox_ai/$pkg_name dependencies installed"
        cd - > /dev/null
        return 0
      fi
    else
      if $npm_cmd >/dev/null 2>&1; then
        debug_log "    @blackbox_ai/$pkg_name dependencies installed"
        cd - > /dev/null
        return 0
      fi
    fi
    
    local exit_code=$?
    
    if [ $attempt -lt $max_attempts ]; then
      debug_log "    Attempt $attempt failed, retrying in 2 seconds..."
      
      # Try clearing npm cache before retry
      if [ $attempt -eq 2 ]; then
        debug_log "    Clearing npm cache..."
        npm cache clean --force >/dev/null 2>&1 || true
      fi
      
      sleep 2
    fi
    attempt=$((attempt + 1))
  done
  
  # If all attempts failed
  if [ "$is_critical" = "true" ]; then
    echo "Error: Failed to install dependencies for @blackbox_ai/$pkg_name after $max_attempts attempts"
    cd - > /dev/null
    return 1
  else
    debug_log "    Warning: Could not install dependencies for @blackbox_ai/$pkg_name"
    cd - > /dev/null
    return 0
  fi
}

show_progress "Ensuring requirements"
# Track if any CRITICAL installation failed
CRITICAL_INSTALL_FAILED=false


# Install dependencies for each local package (non-critical)
for pkg_dir in core test-utils vscode-ide-companion; do
  PKG_ROOT="$BLACKBOX_INSTALL_DIR/packages/$pkg_dir"
  if [ -d "$PKG_ROOT" ]; then
    pkg_name=$(get_package_name "$pkg_dir")
  fi
done

# Install CLI dependencies (CRITICAL)
debug_log "  Installing CLI dependencies..."
CLI_DIST="$BLACKBOX_INSTALL_DIR/packages/cli/dist"
if ! install_package_deps "$CLI_DIST" "blackbox-cli" "true"; then
  CRITICAL_INSTALL_FAILED=true
fi


# Only create symlinks if CLI installation succeeded
if [ "$CRITICAL_INSTALL_FAILED" = false ]; then
  debug_log "Linking local packages to CLI node_modules..."

  CLI_NODE_MODULES="$BLACKBOX_INSTALL_DIR/packages/cli/dist/node_modules"

  if [ -d "$CLI_NODE_MODULES" ]; then
    for pkg_dir in core test-utils vscode-ide-companion; do
      # Only create symlinks for packages that don't have their own node_modules
      # or whose installation failed (so they can use CLI's dependencies)
      PKG_ROOT="$BLACKBOX_INSTALL_DIR/packages/$pkg_dir"
      PKG_DIST="$BLACKBOX_INSTALL_DIR/packages/$pkg_dir/dist"
      
      # Link both root and dist directories
      for target_dir in "$PKG_ROOT" "$PKG_DIST"; do
        if [ -d "$target_dir" ]; then
          NM_LINK="$target_dir/node_modules"
          
          # Remove existing node_modules if present
          if [ -e "$NM_LINK" ] || [ -L "$NM_LINK" ]; then
            rm -rf "$NM_LINK" 2>/dev/null || true
          fi
          
          # Create symlink
          if ln -s "$CLI_NODE_MODULES" "$NM_LINK" 2>/dev/null; then
            debug_log "  Linked node_modules for $pkg_dir"
          else
            debug_log "  Warning: Could not create symlink for $pkg_dir"
          fi
        fi
      done
    done
  else
    debug_log "  Warning: CLI node_modules not found, skipping symlink creation"
  fi
else
  debug_log "Skipping symlink creation due to CLI installation failure"
fi

# --- 8.11) Handle CRITICAL installation failures ---
if [ "$CRITICAL_INSTALL_FAILED" = true ]; then
  echo ""
  echo "Error: Installation failed - could not install CLI dependencies"
  echo ""
  echo "Please try again:"
  echo "  curl -fsSL https://shell.blackbox.ai/api/scripts/blackbox-cli-v2/download.sh | bash"
  echo ""
  exit 1
fi

# --- 9) Create bin directory if needed ---
if [ ! -d "$BLACKBOX_BIN_DIR" ]; then
  debug_log "Creating bin directory: $BLACKBOX_BIN_DIR"
  mkdir -p "$BLACKBOX_BIN_DIR"
fi

# --- 10) Create executable wrapper script ---
show_progress "Creating executable wrapper"
WRAPPER_MJS="$BLACKBOX_BIN_DIR/blackbox.mjs"
WRAPPER_SCRIPT="$BLACKBOX_BIN_DIR/blackbox"

debug_log "Creating executable wrapper at $BLACKBOX_BIN_DIR"

# Create the ES module file
cat > "$WRAPPER_MJS" << 'EOF'
#!/usr/bin/env node

// Blackbox CLI v2 Wrapper
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

// Determine installation directory
const installDir = process.env.BLACKBOX_INSTALL_DIR || join(process.env.HOME, '.blackbox-cli-v2');
const cliEntry = join(installDir, 'packages', 'cli', 'dist', 'index.js');

// Verify CLI entry point exists
if (!existsSync(cliEntry)) {
  console.error('Error: Blackbox CLI v2 installation not found at:', installDir);
  console.error('Expected entry point:', cliEntry);
  console.error('\nPlease reinstall Blackbox CLI v2.');
  process.exit(1);
}

// Set up environment
process.env.BLACKBOX_CLI_V2_ROOT = installDir;

// Load and execute the CLI using dynamic import
try {
  await import(cliEntry);
} catch (error) {
  console.error('Error running Blackbox CLI v2:', error.message);
  process.exit(1);
}
EOF

chmod +x "$WRAPPER_MJS"

# Create a shell script wrapper that calls the .mjs file
cat > "$WRAPPER_SCRIPT" << EOF
#!/bin/sh
# Blackbox CLI v2 Wrapper Script
exec node "$WRAPPER_MJS" "\$@"
EOF

chmod +x "$WRAPPER_SCRIPT"

# --- 11) Verify installation ---
debug_log "Verifying installation..."
if ! "$WRAPPER_SCRIPT" --version >/dev/null 2>&1; then
  debug_log "Warning: Could not verify installation with --version command."
  debug_log "The CLI may still work, but please test it manually."
fi

# --- 12) Configure Blackbox (Optional) ---
# Skip interactive configuration during installation since stdin is not a TTY when piped from curl
# Users can run 'blackbox configure' manually after installation
if [ "$CONFIGURE" = true ] && [ -t 0 ]; then
  # Only run configure if stdin is a terminal (not piped)
  echo ""
  echo "Configuring Blackbox CLI v2"
  echo ""
  if ! "$WRAPPER_SCRIPT" configure; then
    echo "Warning: Configuration failed or was skipped."
    echo "You can run 'blackbox configure' manually later."
  fi
else
  if [ "$CONFIGURE" = true ]; then
    debug_log ""
    debug_log "Skipping interactive configuration (not running in a terminal)."
    debug_log "You can run 'blackbox configure' manually after installation."
  else
    debug_log "Skipping 'blackbox configure', you may need to run this manually later"
  fi
fi

# --- 13) Check PATH and add to shell configuration if needed ---
show_progress "Configuring PATH"
PATH_INSTRUCTIONS=""
if [[ ":$PATH:" != *":$BLACKBOX_BIN_DIR:"* ]]; then
  debug_log "Adding $BLACKBOX_BIN_DIR to your PATH..."
  
  # Determine the appropriate shell configuration file
  if [ "$OS" = "darwin" ]; then
    SHELL_CONFIG="$HOME/.zshrc"
    SHELL_NAME="zsh"
  else
    SHELL_CONFIG="$HOME/.bashrc"
    SHELL_NAME="bash"
  fi
  
  # Create the shell config file if it doesn't exist
  if [ ! -f "$SHELL_CONFIG" ]; then
    debug_log "Creating $SHELL_CONFIG..."
    touch "$SHELL_CONFIG"
  fi
  
  # Check if the PATH export already exists
  if ! grep -q "export PATH.*$BLACKBOX_BIN_DIR" "$SHELL_CONFIG"; then
    debug_log "Adding Blackbox CLI v2 to PATH in $SHELL_CONFIG..."
    echo "" >> "$SHELL_CONFIG"
    echo "# Added by Blackbox CLI v2 installer" >> "$SHELL_CONFIG"
    echo "export PATH=\"$BLACKBOX_BIN_DIR:\$PATH\"" >> "$SHELL_CONFIG"
    echo "export BLACKBOX_INSTALL_DIR=\"$BLACKBOX_INSTALL_DIR\"" >> "$SHELL_CONFIG"
    debug_log "PATH successfully added to $SHELL_CONFIG for future terminal sessions."
    
    PATH_INSTRUCTIONS="To use Blackbox CLI v2 immediately, run:
    export PATH=\"$BLACKBOX_BIN_DIR:\$PATH\"

Or restart your terminal."
  else
    debug_log "PATH entry already exists in $SHELL_CONFIG"
    PATH_INSTRUCTIONS="To use Blackbox CLI v2 immediately, run:
    export PATH=\"$BLACKBOX_BIN_DIR:\$PATH\"

Or restart your terminal."
  fi
fi

show_progress "Installation complete"
echo ""  # New line after progress is done
log "\033[32m✓ Blackbox CLI v2 version $VERSION installed successfully!\033[0m"

if [ -n "$PATH_INSTRUCTIONS" ]; then
  echo ""
  echo "$PATH_INSTRUCTIONS"
fi

# --- 14) Auto-restart if triggered by CLI update ---
AUTO_RESTART="${AUTO_RESTART:-false}"
RESUME_CHECKPOINT="${RESUME_CHECKPOINT:-}"

if [ "$AUTO_RESTART" = "true" ]; then
  debug_log ""
  debug_log "Auto-restart enabled, restarting Blackbox CLI..."
  
  # Add bin directory to PATH for this session if not already present
  if [[ ":$PATH:" != *":$BLACKBOX_BIN_DIR:"* ]]; then
    export PATH="$BLACKBOX_BIN_DIR:$PATH"
  fi
  
  # Wait a moment for file system to settle
  sleep 1
  
  # Restart the CLI with TTY properly connected
  # Use exec with explicit stdin/stdout/stderr redirection to preserve TTY
  # The </dev/tty >/dev/tty 2>&1 ensures the CLI has proper terminal access
  if [ -n "$RESUME_CHECKPOINT" ]; then
    debug_log "Restarting with checkpoint: $RESUME_CHECKPOINT"
    exec "$WRAPPER_SCRIPT" --resume-checkpoint "$RESUME_CHECKPOINT" </dev/tty >/dev/tty 2>&1
  else
    debug_log "Restarting in interactive mode"
    exec "$WRAPPER_SCRIPT" </dev/tty >/dev/tty 2>&1
  fi
fi