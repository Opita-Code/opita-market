console.log("PTD_RAZON_SOCIAL:", JSON.stringify(process.env.PTD_RAZON_SOCIAL));
console.log("PTD_NIT:", JSON.stringify(process.env.PTD_NIT));
console.log("All PTD_*:", Object.keys(process.env).filter(k => k.startsWith("PTD_")));
