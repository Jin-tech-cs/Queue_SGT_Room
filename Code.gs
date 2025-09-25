/**** AstroQueue Secure MultiRoom (by-ID) - Code.gs ****/
const SHEET_ID   = '1ubcag2_Tc6vi4BSggICJKqpx456UnCi6Td3wGwlS_p0';
const SHEET_ROOMS = 'Rooms';
const SHEET_QUEUE = 'Queue';
const ADMIN_KEY   = 'sgt_jin';

function onOpen(){ ensureSetup_(); }

function ss_(){ return SpreadsheetApp.openById(SHEET_ID); }

// ✅ sheet_ 중복 제거: 반드시 ID 기반만 사용
function sheet_(name){
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error(`${name} sheet missing`);
  return sh;
}

/** 시트 준비 */
function ensureSetup_(){
  const ss = ss_();
  let r = ss.getSheetByName(SHEET_ROOMS);
  if (!r){
    r = ss.insertSheet(SHEET_ROOMS);
    r.getRange(1,1,1,4).setValues([['roomId','roomName','created','active']]);
  }
  let q = ss.getSheetByName(SHEET_QUEUE);
  if (!q){
    q = ss.insertSheet(SHEET_QUEUE);
    q.getRange(1,1,1,6).setValues([['id','roomId','name','timestamp','status','note']]);
  }
}

const nowISO_ = () => new Date().toISOString();
const uuid_   = () => Utilities.getUuid();

// ✅ 빌드 스탬프(캐시/배포 확인용)
const BUILD = 'build-' + new Date().toISOString().replace(/[:.]/g,'-');

// ✅ doGet도 단일 정의(템플릿 + BUILD 표시)
function doGet(e){
  ensureSetup_();
  const t = HtmlService.createTemplateFromFile('Index');
  t.BUILD = BUILD;
  return t.evaluate()
          .setTitle('AstroQueue Secure MultiRoom')
          .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** 방 목록(활성) */
function listRooms(){
  ensureSetup_();
  return readRooms_().filter(r=>r.active)
                     .map(r=>({roomId:r.roomId, roomName:r.roomName}));
}

function readRooms_(){
  const sh = sheet_(SHEET_ROOMS);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2,1,last-1,4).getValues().map(r=>({
    roomId: String(r[0]||''),
    roomName: String(r[1]||''),
    created: String(r[2]||''),
    active: String(r[3]||'true') === 'true'
  }));
}

function writeRoomRow_(row,obj){
  sheet_(SHEET_ROOMS).getRange(row,1,1,4)
    .setValues([[obj.roomId,obj.roomName,obj.created,obj.active]]);
}

function readQueue_(){
  const sh = sheet_(SHEET_QUEUE);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2,1,last-1,6).getValues().map(r=>({
    id: String(r[0]||''),
    roomId: String(r[1]||''),
    name: String(r[2]||''),
    ts: String(r[3]||''),
    status: String(r[4]||''),
    note: String(r[5]||'')
  }));
}

function writeQueueRow_(row,obj){
  sheet_(SHEET_QUEUE).getRange(row,1,1,6)
    .setValues([[obj.id,obj.roomId,obj.name,obj.ts,obj.status,obj.note]]);
}
function appendQueue_(obj){
  sheet_(SHEET_QUEUE).appendRow([obj.id,obj.roomId,obj.name,obj.ts,obj.status,obj.note]);
}

/** 방 생성(관리자) */
function createRoom(adminKey, roomName){
  ensureSetup_();
  if (adminKey !== ADMIN_KEY) throw new Error('관리자 키가 올바르지 않습니다.');
  if (!roomName) throw new Error('방 이름을 입력하세요.');

  const rooms = readRooms_();
  let base = roomName.trim().replace(/\s+/g,'-').replace(/[^0-9A-Za-z가-힣\-_.]/g,'');
  let rid = base || ('room-' + Math.random().toString(36).slice(2,6));
  let i=1; while (rooms.find(r=>r.roomId===rid)) rid = `${base}-${i++}`;

  const obj = { roomId: rid, roomName, created: nowISO_(), active: true };
  sheet_(SHEET_ROOMS).appendRow([obj.roomId,obj.roomName,obj.created,obj.active]);
  return {ok:true, message:`방 생성: ${roomName} (${rid})`, roomId: rid};
}

/** 방 비활성(관리자) */
function deactivateRoom(adminKey, roomId){
  ensureSetup_();
  if (adminKey !== ADMIN_KEY) throw new Error('관리자 키가 올바르지 않습니다.');
  const rooms = readRooms_();
  const idx = rooms.findIndex(r=>r.roomId===roomId);
  if (idx<0) return {ok:false, message:'해당 방을 찾지 못했습니다.'};
  rooms[idx].active = false;
  writeRoomRow_(idx+2, rooms[idx]);
  return {ok:true, message:`비활성화: ${rooms[idx].roomName}`};
}

/** 상태 조회(특정 방) */
function getState(roomId, myName){
  ensureSetup_();
  if (!roomId) throw new Error('roomId 필요');
  const rooms = readRooms_();
  const room = rooms.find(r=>r.roomId===roomId && r.active);
  if (!room) throw new Error('해당 방이 없거나 비활성입니다.');

  const all = readQueue_().filter(x=>x.roomId===roomId);
  const waiting = all.filter(x=>x.status==='waiting');
  const serving = all.filter(x=>x.status==='serving');
  const myIdx = myName ? waiting.findIndex(x=>x.name===myName) : -1;
  const myPos = myIdx>=0 ? (myIdx+1) : null;

  return {
    room: {roomId: room.roomId, roomName: room.roomName},
    queueLength: waiting.length,
    waiting: waiting.map((x,i)=>({pos:i+1, name:x.name, since:x.ts})).slice(0,100),
    serving: serving.map(x=>({name:x.name, since:x.ts})),
    myPos
  };
}

/** 참가(이름만) */
function joinQueue(roomId, name){
  ensureSetup_();
  if (!roomId) throw new Error('roomId 필요');
  if (!name) throw new Error('이름이 필요해요');

  const rooms = readRooms_();
  if (!rooms.find(r=>r.roomId===roomId && r.active))
    throw new Error('해당 방이 없거나 비활성입니다.');

  const all = readQueue_().filter(x=>x.roomId===roomId);
  const exists = all.find(x => (x.status==='waiting'||x.status==='serving') && x.name===name);
  if (exists) return {ok:true, message:'이미 이 방 대기열에 있어요.', entryId: exists.id};

  const id = uuid_();
  const obj = { id, roomId, name, ts: nowISO_(), status:'waiting', note:'' };
  appendQueue_(obj);
  return {ok:true, message:'대기열에 등록되었습니다.', entryId: id};
}

/** 사용자 스스로 나가기(삭제): entryId로만 */
function leaveQueueById(roomId, entryId){
  ensureSetup_();
  if (!roomId) throw new Error('roomId 필요');
  if (!entryId) throw new Error('entryId 필요');

  const all = readQueue_();
  for (let i=0;i<all.length;i++){
    const r = all[i];
    if (r.roomId===roomId && r.id===entryId && (r.status==='waiting'||r.status==='serving')){
      r.status='left';
      writeQueueRow_(i+2, r);
      return {ok:true, message:'대기에서 제거되었습니다.'};
    }
  }
  return {ok:false, message:'해당 항목을 찾지 못했거나 이미 처리되었습니다.'};
}

/** 관리자: 다음 호출 */
function nextUp(adminKey, roomId){
  ensureSetup_();
  if (adminKey !== ADMIN_KEY) throw new Error('관리자 키가 올바르지 않습니다.');
  const all = readQueue_().map((x,idx)=>({...x,_row:idx+2}));
  const current = all.find(x=>x.roomId===roomId && x.status==='serving');
  if (current) return {ok:false, message:`이미 진행중: ${current.name}`};

  const next = all.find(x=>x.roomId===roomId && x.status==='waiting');
  if (!next) return {ok:false, message:'대기 중인 인원이 없습니다.'};

  next.status='serving';
  next.ts = nowISO_();
  writeQueueRow_(next._row, next);
  return {ok:true, message:`호출: ${next.name}`, name: next.name};
}

/** 관리자: 현재 진행 완료 */
function finishCurrent(adminKey, roomId){
  ensureSetup_();
  if (adminKey !== ADMIN_KEY) throw new Error('관리자 키가 올바르지 않습니다.');
  const all = readQueue_().map((x,idx)=>({...x,_row:idx+2}));
  const cur = all.find(x=>x.roomId===roomId && x.status==='serving');
  if (!cur) return {ok:false, message:'진행중인 인원이 없습니다.'};
  cur.status='done';
  writeQueueRow_(cur._row, cur);
  return {ok:true, message:'현재 진행 건을 완료했습니다.'};
}

/** 관리자: 특정 이름 강제 삭제 */
function adminDeleteByName(adminKey, roomId, name){
  ensureSetup_();
  if (adminKey !== ADMIN_KEY) throw new Error('관리자 키가 올바르지 않습니다.');
  if (!name) throw new Error('삭제할 이름을 입력하세요');
  const all = readQueue_().map((x,idx)=>({...x,_row:idx+2}));
  const target = all.find(x=>x.roomId===roomId && (x.status==='waiting'||x.status==='serving') && x.name===name);
  if (!target) return {ok:false, message:'대기열에서 해당 이름을 찾지 못했습니다.'};
  target.status='left';
  writeQueueRow_(target._row, target);
  return {ok:true, message:`삭제됨: ${name}`};
}

/** 관리자: 대기 전원 삭제 */
function clearWaiting(adminKey, roomId){
  ensureSetup_();
  if (adminKey !== ADMIN_KEY) throw new Error('관리자 키가 올바르지 않습니다.');
  const all = readQueue_().map((x,idx)=>({...x,_row:idx+2}));
  let n=0;
  all.forEach(r=>{
    if (r.roomId===roomId && r.status==='waiting'){
      r.status='left';
      writeQueueRow_(r._row, r);
      n++;
    }
  });
  return {ok:true, message:`대기중 ${n}명 제거`};
}
