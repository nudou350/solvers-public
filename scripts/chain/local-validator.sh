cd ~ && rm -rf ~/solvers-ledger
exec ~/.local/share/solana/install/releases/stable-44b42d45ec7e555b26ca15ad924a7432d18aaa9f/solana-release/bin/solana-test-validator --reset --quiet --ledger ~/solvers-ledger \
  --bpf-program DW6UzJDR9X388f6keJSLXz7WgRVJFntbvonSskRrWNaW ~/solvers-build/target/deploy/solvers.so \
  --bpf-program CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d ${SRC:-$(cd "$(dirname "$0")/../.." && pwd)}/programs/solvers/tests/fixtures/mpl_core.so \
  --mint J4riUZWJELvMbYwcXuQ3iDHcF6LaFFEmSXDLH618AGy4
