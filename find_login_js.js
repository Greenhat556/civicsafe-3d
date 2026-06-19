const fs = require('fs');

const js = fs.readFileSync('app.js', 'utf8');
const lines = js.split('\n');

lines.forEach((line, idx) => {
  if (line.includes('login-screen') || line.includes('loginScreen') || line.includes('auth-form') || line.includes('Sign In')) {
    console.log(`Line ${idx + 1}: ${line.trim()}`);
  }
});
