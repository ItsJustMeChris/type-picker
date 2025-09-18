#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<USAGE
Usage: ${0##*/} <install|update|uninstall>

Commands:
  install    Build the CLI (if needed) and symlink it as tsp on your PATH
  update     Rebuild the CLI and refresh the symlink
  uninstall  Remove the tsp symlink

Environment overrides:
  TSP_INSTALL_PATH  Exact file path for the tsp symlink (default: ~/.local/bin/tsp)
  TSP_INSTALL_DIR   Directory to host tsp if TSP_INSTALL_PATH is not set
  TSP_SKIP_PATH_UPDATE  Set to 1 to skip shell config editing even if PATH is missing
USAGE
}

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "${SCRIPT_DIR}/.." && pwd)
DIST_PATH="${ROOT_DIR}/dist/cli.js"
INSTALL_PATH=${TSP_INSTALL_PATH:-${TSP_INSTALL_DIR:-${HOME}/.local/bin}/tsp}
INSTALL_DIR=$(dirname "${INSTALL_PATH}")

ensure_bun() {
  if ! command -v bun >/dev/null 2>&1; then
    echo "Error: bun is required but not found in PATH" >&2
    exit 1
  fi
}

ensure_built() {
  if [[ ! -f "${DIST_PATH}" ]]; then
    echo "Building dist/cli.js via bun run build"
    ensure_bun
    (cd "${ROOT_DIR}" && bun run build)
  fi
  chmod +x "${DIST_PATH}"
}

path_contains() {
  case ":${PATH}:" in
    *:"$1":*) return 0 ;;
    *) return 1 ;;
  esac
}

maybe_update_shell_config() {
  if [[ ${TSP_SKIP_PATH_UPDATE:-0} == 1 ]]; then
    echo "Warning: ${INSTALL_DIR} is not on PATH. Add it manually (e.g. export PATH=\"${INSTALL_DIR}:\$PATH\")." >&2
    return
  fi

  local shell_name
  shell_name="$(basename "${SHELL:-}")"

  case "${shell_name}" in
    zsh)
      add_path_line "${HOME}/.zshrc" "${INSTALL_DIR}" "zsh"
      ;;
    bash)
      local config
      if [[ -n ${BASH_VERSION:-} ]]; then
        config="${HOME}/.bashrc"
      else
        config="${HOME}/.bash_profile"
      fi
      add_path_line "${config}" "${INSTALL_DIR}" "bash"
      ;;
    *)
      echo "Warning: ${INSTALL_DIR} is not on PATH. Add it in your shell config (shell detected: ${shell_name:-unknown})." >&2
      ;;
  esac
}

add_path_line() {
  local config_file="$1"
  local dir="$2"
  local shell_label="$3"

  if [[ -f "${config_file}" ]] && grep -Fq "${dir}" "${config_file}"; then
    echo "Warning: ${dir} is not currently active on PATH. Reload your ${shell_label} shell or source ${config_file}." >&2
    return
  fi

  if ! touch "${config_file}" 2>/dev/null; then
    echo "Warning: ${dir} is not on PATH and ${config_file} is not writable. Add export PATH=\"${dir}:\$PATH\" manually." >&2
    return
  fi

  {
    printf '\n# Added by tsp-manage.sh on %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'export PATH="%s:$PATH" # tsp-manage\n' "${dir}"
  } >>"${config_file}"

  echo "Added ${dir} to PATH in ${config_file}. Restart your ${shell_label} shell or run: source ${config_file}" >&2
}

ensure_path() {
  if path_contains "${INSTALL_DIR}"; then
    return
  fi

  echo "Warning: ${INSTALL_DIR} is not on PATH." >&2
  maybe_update_shell_config
}

install() {
  ensure_built
  if ! mkdir -p "${INSTALL_DIR}" 2>/dev/null; then
    echo "Error: unable to create ${INSTALL_DIR}. Set TSP_INSTALL_PATH or TSP_INSTALL_DIR to a writable location." >&2
    exit 1
  fi
  if ! ln -sf "${DIST_PATH}" "${INSTALL_PATH}"; then
    echo "Error: failed to write symlink to ${INSTALL_PATH}" >&2
    exit 1
  fi
  ensure_path
  echo "Installed tsp -> ${DIST_PATH}"
}

update() {
  ensure_bun
  echo "Updating tsp build"
  (cd "${ROOT_DIR}" && bun run build)
  install
}

uninstall() {
  if [[ -L "${INSTALL_PATH}" || -f "${INSTALL_PATH}" ]]; then
    rm -f "${INSTALL_PATH}"
    echo "Removed ${INSTALL_PATH}"
  else
    echo "tsp is not currently installed at ${INSTALL_PATH}"
  fi
}

main() {
  if [[ $# -ne 1 ]]; then
    usage >&2
    exit 1
  fi

  case "$1" in
    install)
      install
      ;;
    update)
      update
      ;;
    uninstall)
      uninstall
      ;;
    -h|--help|help)
      usage
      ;;
    *)
      echo "Unknown command: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
}

main "$@"
