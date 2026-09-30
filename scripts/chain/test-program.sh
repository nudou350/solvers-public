set -e
SRC=${SRC:-$(cd "$(dirname "$0")/../.." && pwd)}
DST=$HOME/solvers-build
rsync -a --exclude node_modules --exclude target --exclude .git --exclude apps --exclude .turbo $SRC/ $DST/
cd $DST
cargo test -p solvers --test program 2>&1 | grep -v -E "^\s*(Compiling|Downloaded|Downloading)" | tail -${TAILN:-80}
