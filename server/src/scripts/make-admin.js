// Bir kullaniciyi admin yapar.
// Kullanim:  npm --prefix server run make-admin -- <email-veya-kullanici-adi>
import { getUserByLogin, setRole } from '../store/users.js';

const identifier = process.argv[2];
if (!identifier) {
  console.error('Kullanim: npm run make-admin -- <email-veya-kullanici-adi>');
  process.exit(1);
}

const user = getUserByLogin(identifier);
if (!user) {
  console.error('Kullanici bulunamadi:', identifier);
  process.exit(1);
}

setRole(user.id, 'admin');
console.log(`OK: ${user.username} (${user.email}) artik admin.`);
process.exit(0);
