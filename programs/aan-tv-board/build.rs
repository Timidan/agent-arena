fn main() {
    if let Some((_, wasm_path)) = sails_rs::build_wasm() {
        sails_rs::ClientBuilder::<aan_tv_board_app::Program>::from_wasm_path(wasm_path).build_idl();
    }
}
