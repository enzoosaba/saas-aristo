import {DatabaseSync,backup} from 'node:sqlite';
import {existsSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
const source=resolve(process.env.DATABASE_PATH||'data/aristo.sqlite');
if(!existsSync(source))throw Error('Banco não encontrado. Configure DATABASE_PATH.');
const folder=resolve('data/backups');mkdirSync(folder,{recursive:true});
const destination=join(folder,`aristo-${Date.now()}.sqlite`);
const connection=new DatabaseSync(source,{readOnly:true});
try{await backup(connection,destination);const copy=new DatabaseSync(destination,{readOnly:true});const result=copy.prepare('PRAGMA integrity_check').get();copy.close();if(result.integrity_check!=='ok')throw Error('Backup não passou na verificação');console.log(`Backup íntegro criado em ${destination}`);}finally{connection.close();}
