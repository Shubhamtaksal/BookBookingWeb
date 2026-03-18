const bcrypt = require("bcryptjs");

async function run() {
  const plainPassword = "admin123";
  const hash = await bcrypt.hash(plainPassword, 10);

  console.log("PASSWORD:", plainPassword);
  console.log("HASH:", hash);
}

run();