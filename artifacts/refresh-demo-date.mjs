import {DatabaseSync,backup} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
const db=new DatabaseSync('data/coelho.sqlite');const id=process.argv[2];if(!id)throw Error('Informe o ID da conta.');
if(!db.prepare('SELECT user_id FROM demo_batches WHERE user_id=?').get(id))throw Error('Conta sem dados de demonstração.');
mkdirSync('data/backups',{recursive:true});await backup(db,`data/backups/demo-date-refresh-${Date.now()}.sqlite`);
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bahia',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const previous=new Date(today+'T12:00:00Z');previous.setUTCDate(previous.getUTCDate()-1);const yesterday=previous.toISOString().slice(0,10);
const items=db.prepare("SELECT id,data FROM items WHERE user_id=? AND json_extract(data,'$.notes')=? AND json_extract(data,'$.kind')='habit'").all(id,'Exemplo para apresentação da plataforma.');
db.exec('BEGIN IMMEDIATE');try{for(const row of items){const item=JSON.parse(row.data);db.prepare('UPDATE records SET value=target,done=1 WHERE user_id=? AND item_id=? AND date=? AND version=1').run(id,row.id,yesterday);db.prepare('INSERT OR IGNORE INTO records(user_id,item_id,date,value,done,target) VALUES(?,?,?,?,?,?)').run(id,row.id,today,Math.floor(item.target*.6),0,item.target);}db.exec('COMMIT');console.log('Registros demonstrativos atualizados para '+today+'.');}catch(e){db.exec('ROLLBACK');throw e;}finally{db.close();}
