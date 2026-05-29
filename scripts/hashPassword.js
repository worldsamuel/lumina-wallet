#!/usr/bin/env node

const bcrypt = require("bcryptjs");

const password = process.argv[2];
const saltRounds = 10;

if (!password) {
  console.error('Usage: node scripts/hashPassword.js "MyStrongP@ssw0rd"');
  process.exit(1);
}

if (password.length < 8) {
  console.error("Password must be at least 8 characters long.");
  process.exit(1);
}

/**
 * Prints a bcrypt hash that can be stored in AdminUser.passwordHash.
 */
async function main() {
  const hash = await bcrypt.hash(password, saltRounds);
  console.log(hash);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
