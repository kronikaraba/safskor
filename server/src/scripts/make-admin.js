// Bir kullanıcıyı admin yapar.
// Kullanım:  npm --prefix server run make-admin -- <email-veya-kullanıcı-adı>
import { initDb } from '../db.js';
import { getUserByLogin, setRole } from '../store/users.js';

const identifier = process.argv[2];
if (!identifier) {
  console.error('Kullanım: npm run make-admin -- <email-veya-kullanıcı-adı>');
  process.exit(1);
}

await initDb();

const user = await getUserByLogin(identifier);
if (!user) {
  console.error('Kullanıcı bulunamadı:', identifier);
  process.exit(1);
}

await setRole(user.id, 'admin');
console.log(`OK: ${user.username} (${user.email}) artık admin.`);
process.exit(0);
