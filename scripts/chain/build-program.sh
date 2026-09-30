set -e
SRC=${SRC:-$(cd "$(dirname "$0")/../.." && pwd)}
DST=$HOME/solvers-build
mkdir -p $DST/target/deploy
rsync -a --delete --exclude node_modules --exclude target --exclude .git --exclude apps --exclude .turbo $SRC/ $DST/ 
cp ~/solvers-keys/program.json $DST/target/deploy/solvers-keypair.json
cd $DST
anchor build --arch ${ARCH:-v1} 2>&1 | grep -v "^\s*Compiling" | tail -${TAILN:-60}
mkdir -p $SRC/target/idl $SRC/target/types
cp target/idl/solvers.json $SRC/target/idl/ && cp target/idl/solvers.json $SRC/packages/solvers-client/idl/
cp target/types/solvers.ts $SRC/target/types/ 2>/dev/null || true
mkdir -p $SRC/target/deploy && cp target/deploy/solvers.so $SRC/target/deploy/ 2>/dev/null || true
ls -la target/deploy
