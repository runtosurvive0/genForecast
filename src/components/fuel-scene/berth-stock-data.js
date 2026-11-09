// Both screens consume the same synchronous snapshot.
import {StockSnapshot} from '../../data/fuel-reference/stock-snapshot.js';
export const stockSnapshot = StockSnapshot;
export const endpointLots=id=>stockSnapshot.lots.filter(l=>l.pile?('pile-'+l.pile)===id:('shed-'+l.shed.toLowerCase())===id);
export function stockDescription(l){
 const where=l.pile?'Pile '+l.pile:l.shed+' Shed · '+l.cell+' CELL';
 return where+' · '+l.coal+' · '+l.tons.toLocaleString('ko-KR')+' t'+(l.tons===0?' · 소진':'')+'\n항차 '+l.voyage+(l.days==null?'':' · D+'+l.days)+'\n적치 형상 개념 표현';
}
