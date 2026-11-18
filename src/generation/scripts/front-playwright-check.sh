#!/usr/bin/env bash
set -euo pipefail

expected="${FRONT_PLAYWRIGHT_VERSION:-}"
browser_root="${PLAYWRIGHT_BROWSERS_PATH:-/ms-playwright}"
project_dir="${1:-.}"

if [[ -z "${expected}" ]]; then
  echo "FRONT_PLAYWRIGHT_VERSION is not set" >&2
  exit 2
fi

docker_info="${browser_root}/.docker-info"
if [[ ! -f "${docker_info}" ]]; then
  echo "missing Playwright browser metadata: ${docker_info}" >&2
  exit 2
fi

browser_version="$(jq -r '.driverVersion // empty' "${docker_info}")"
if [[ "${browser_version}" != "${expected}" ]]; then
  echo \
    "Playwright browser mismatch: expected ${expected}, found ${browser_version:-unknown}" \
    >&2
  exit 1
fi

package_json="${project_dir}/package.json"
if [[ ! -f "${package_json}" ]]; then
  echo "Playwright runtime ${expected}: browser bundle is compatible"
  exit 0
fi

status=0
packages=("@playwright/test" "playwright" "playwright-core")
sections=("dependencies" "devDependencies" "optionalDependencies" "peerDependencies")

for package in "${packages[@]}"; do
  for section in "${sections[@]}"; do
    spec="$(
      jq -r \
        --arg section "${section}" \
        --arg package "${package}" \
        '.[$section][$package] // empty' \
        "${package_json}"
    )"
    if [[ -n "${spec}" && "${spec}" != "${expected}" ]]; then
      echo \
        "${package_json}: ${section}.${package} must be exactly ${expected}; found ${spec}" \
        >&2
      status=1
    fi
  done
done

package_lock="${project_dir}/package-lock.json"
if [[ -f "${package_lock}" ]]; then
  for package in "${packages[@]}"; do
    resolved="$(
      jq -r \
        --arg path "node_modules/${package}" \
        '.packages[$path].version // empty' \
        "${package_lock}"
    )"
    if [[ -n "${resolved}" && "${resolved}" != "${expected}" ]]; then
      echo \
        "${package_lock}: ${package} resolved to ${resolved}; expected ${expected}" \
        >&2
      status=1
    fi
  done
fi

for package in "${packages[@]}"; do
  installed_json="${project_dir}/node_modules/${package}/package.json"
  if [[ ! -f "${installed_json}" ]]; then
    continue
  fi
  installed="$(jq -r '.version // empty' "${installed_json}")"
  if [[ -n "${installed}" && "${installed}" != "${expected}" ]]; then
    echo \
      "${installed_json}: installed ${installed}; expected ${expected}" \
      >&2
    status=1
  fi
done

if [[ "${status}" -ne 0 ]]; then
  echo \
    "Pin Playwright dependencies to ${expected}, run npm install, then retry." \
    >&2
  exit "${status}"
fi

echo "Playwright runtime ${expected}: browser bundle and project dependencies match"
