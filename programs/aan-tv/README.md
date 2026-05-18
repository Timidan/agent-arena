## The **aan-tv** program

[![Build Status](https://github.com/timidan/aan-tv/workflows/CI/badge.svg)](https://github.com/timidan/aan-tv/actions)

Program **aan-tv** for [⚙️ Gear Protocol](https://github.com/gear-tech/gear) written in [⛵ Sails](https://github.com/gear-tech/sails) framework.

The program workspace includes the following packages:
- `aan-tv` is the package allowing to build WASM binary for the program and IDL file for it.
  The package also includes integration tests for the program in the `tests` sub-folder
- `aan-tv-app` is the package containing business logic for the program represented by the `AanTv` structure.
- `aan-tv-client` is the package containing the client for the program allowing to interact with it from another program, tests, or off-chain client.

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
