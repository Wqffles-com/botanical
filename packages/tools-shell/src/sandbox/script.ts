/**
 * Static jail entry script. It is written to a temp file and executed with
 * host paths only in the environment, never interpolated into the script.
 * Those variables are unset before the user command is exec'd.
 *
 * Mount layout after pivot_root:
 *   /            tmpfs, size-capped (not the host disk)
 *   /usr         host /usr, read-only (binaries and libraries)
 *   /bin,/lib    symlinks into /usr (merged-/usr layout)
 *   /workspace   caller's workspace, read-write
 *   /botanical   optional read-only scratch (the code_exec program)
 *   /tmp,/dev/shm tmpfs
 *   /proc        fresh procfs for this pid namespace
 *   /etc         minimal passwd/group plus copied resolv.conf, hosts, ro ssl
 *   /dev         null, zero, urandom, random
 */
export const ENTER_JAIL_SCRIPT = `#!/bin/bash
set -euo pipefail

if [[ "\${1:-}" != "--" ]]; then
  echo "botanical-jail: expected -- before command" >&2
  exit 64
fi
shift
if [[ "$#" -lt 1 ]]; then
  echo "botanical-jail: missing command" >&2
  exit 64
fi

: "\${BOTANICAL_JAIL_ROOT:?}"
: "\${BOTANICAL_WORKSPACE_HOST:?}"
: "\${BOTANICAL_JAIL_CWD:?}"

JAIL_ROOT=$BOTANICAL_JAIL_ROOT
WORKSPACE=$BOTANICAL_WORKSPACE_HOST
CWD=$BOTANICAL_JAIL_CWD
SCRATCH=\${BOTANICAL_SCRATCH_HOST:-}

case "$CWD" in
  /workspace|/workspace/*) ;;
  *) echo "botanical-jail: refused cwd" >&2; exit 66 ;;
esac

mount --make-rprivate /
mount --bind "$JAIL_ROOT" "$JAIL_ROOT"
# Replace the host-backed directory with a capped tmpfs so writes to /
# cannot fill the host disk. Submounts below attach to this tmpfs.
mount -t tmpfs -o size=32m,mode=755 tmpfs "$JAIL_ROOT"

mkdir -p \
  "$JAIL_ROOT/workspace" \
  "$JAIL_ROOT/tmp" \
  "$JAIL_ROOT/proc" \
  "$JAIL_ROOT/dev" \
  "$JAIL_ROOT/usr" \
  "$JAIL_ROOT/etc" \
  "$JAIL_ROOT/oldroot" \
  "$JAIL_ROOT/botanical"

ln -sfn usr/bin "$JAIL_ROOT/bin"
ln -sfn usr/lib "$JAIL_ROOT/lib"
ln -sfn usr/lib64 "$JAIL_ROOT/lib64"

mount --bind /usr "$JAIL_ROOT/usr"
mount -o remount,bind,ro "$JAIL_ROOT/usr"

mount -t tmpfs -o size=64m,mode=1777 tmpfs "$JAIL_ROOT/tmp"
mkdir -p "$JAIL_ROOT/dev/shm"
mount -t tmpfs -o size=64m,mode=1777 tmpfs "$JAIL_ROOT/dev/shm"

for devnode in null zero urandom random; do
  if [[ -e "/dev/$devnode" ]]; then
    touch "$JAIL_ROOT/dev/$devnode"
    mount --bind "/dev/$devnode" "$JAIL_ROOT/dev/$devnode"
  fi
done
ln -sfn /proc/self/fd "$JAIL_ROOT/dev/fd"
ln -sfn /proc/self/fd/0 "$JAIL_ROOT/dev/stdin"
ln -sfn /proc/self/fd/1 "$JAIL_ROOT/dev/stdout"
ln -sfn /proc/self/fd/2 "$JAIL_ROOT/dev/stderr"

printf 'root:x:0:0:root:/workspace:/bin/sh\nnobody:x:65534:65534:nobody:/workspace:/usr/sbin/nologin\n' > "$JAIL_ROOT/etc/passwd"
printf 'root:x:0:\nnogroup:x:65534:\n' > "$JAIL_ROOT/etc/group"
if [[ -f /etc/resolv.conf ]]; then
  cat /etc/resolv.conf > "$JAIL_ROOT/etc/resolv.conf" || true
fi
if [[ -f /etc/hosts ]]; then
  cat /etc/hosts > "$JAIL_ROOT/etc/hosts" || true
fi
if [[ -d /etc/ssl ]]; then
  mkdir -p "$JAIL_ROOT/etc/ssl"
  mount --bind /etc/ssl "$JAIL_ROOT/etc/ssl"
  mount -o remount,bind,ro "$JAIL_ROOT/etc/ssl"
fi

mount --bind "$WORKSPACE" "$JAIL_ROOT/workspace"
if [[ -n "$SCRATCH" ]]; then
  mount --bind "$SCRATCH" "$JAIL_ROOT/botanical"
  mount -o remount,bind,ro "$JAIL_ROOT/botanical"
fi

/usr/sbin/pivot_root "$JAIL_ROOT" "$JAIL_ROOT/oldroot"
cd /
mount -t proc proc /proc
umount -l /oldroot
if mountpoint -q /oldroot; then
  echo "botanical-jail: failed to detach host root" >&2
  exit 67
fi
rmdir /oldroot 2>/dev/null || true

cd -- "$CWD"

unset BOTANICAL_JAIL_ROOT BOTANICAL_WORKSPACE_HOST BOTANICAL_JAIL_CWD BOTANICAL_SCRATCH_HOST

printf 'READY\n' >&3
exec 3>&-
exec "$@" || {
  echo "botanical-jail: exec failed" >&2
  exit 69
}
`;
