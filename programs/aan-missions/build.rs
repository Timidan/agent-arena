fn main() {
    if let Some((_, wasm_path)) = sails_rs::build_wasm() {
        sails_rs::ClientBuilder::<aan_missions_app::Program>::from_wasm_path(wasm_path).build_idl();
        trim_idl_trailing_blank_lines();
    }
}

fn trim_idl_trailing_blank_lines() {
    let path = std::path::Path::new("client/aan_missions_client.idl");
    let Ok(contents) = std::fs::read_to_string(path) else {
        return;
    };

    let normalized = format!("{}\n", contents.trim_end_matches('\n'));
    if normalized != contents {
        std::fs::write(path, normalized).expect("failed to normalize generated IDL");
    }
}
