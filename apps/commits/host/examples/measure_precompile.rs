//! Times the two ways of getting a component ready to instantiate.
//!
//! `Component::from_file` runs Cranelift over the whole module every launch.
//! `Component::deserialize_file` maps an already-compiled artifact instead.
//! The gap between them is what a precompile step, or a compilation cache,
//! would take off startup.

use std::time::Instant;

use wasmtime::component::Component;

fn main() -> wasmtime::Result<()> {
    let path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "dist/extensions/commits.wasm".to_string());
    let engine = wasm_extensions::host::new_engine()?;

    let started = Instant::now();
    let component = Component::from_file(&engine, &path)?;
    let compile = started.elapsed();

    let started = Instant::now();
    let precompiled = component.serialize()?;
    let serialize = started.elapsed();

    let cwasm = format!("{path}.cwasm");
    std::fs::write(&cwasm, &precompiled)?;

    // Twice: the first reads a file the write just left in the page cache,
    // the second is the steady state a real launch would see.
    let mut deserialize = Vec::new();
    for _ in 0..2 {
        let started = Instant::now();
        // Safe here because this process wrote the file moments ago with the
        // very engine it is handing it back to.
        let _ = unsafe { Component::deserialize_file(&engine, &cwasm)? };
        deserialize.push(started.elapsed());
    }

    println!("wasm_bytes={}", std::fs::metadata(&path)?.len());
    println!("cwasm_bytes={}", precompiled.len());
    println!("compile_ms={:.1}", compile.as_secs_f64() * 1000.0);
    println!("serialize_ms={:.1}", serialize.as_secs_f64() * 1000.0);
    for (nth, elapsed) in deserialize.iter().enumerate() {
        println!("deserialize_{}_ms={:.1}", nth + 1, elapsed.as_secs_f64() * 1000.0);
    }
    Ok(())
}
