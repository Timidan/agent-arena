## The **aan-tv-board** program

[![Build Status](https://github.com/timidan/aan-tv-board/workflows/CI/badge.svg)](https://github.com/timidan/aan-tv-board/actions)

Program **aan-tv-board** for [⚙️ Gear Protocol](https://github.com/gear-tech/gear) written in [⛵ Sails](https://github.com/gear-tech/sails) framework.

The program workspace includes the following packages:
- `aan-tv-board` is the package allowing to build WASM binary for the program and IDL file for it.
  The package also includes integration tests for the program in the `tests` sub-folder
- `aan-tv-board-app` is the package containing business logic for the program represented by the `AanTvBoard` structure.
- `aan-tv-board-client` is the package containing the client for the program allowing to interact with it from another program, tests, or off-chain client.

### 🏗️ Building

```bash
cargo build --release
```

### ✅ Testing

```bash
cargo test --release
```

# License

The source code is licensed under the [MIT license](LICENSE).
