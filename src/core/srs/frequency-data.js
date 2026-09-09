/**
 * Frequency Dictionary — Top ~500 từ tiếng Anh phổ biến nhất
 * 
 * Nguồn: Dựa trên các bảng tần suất từ vựng tiếng Anh (GSL, Oxford 3000)
 * Mục đích: Nếu từ vựng nằm trong danh sách này, hệ thống Heuristics sẽ
 * giảm Difficulty vì người học rất có thể đã quen thuộc với từ đó.
 * 
 * Kích thước: ~4KB (sau gzip ~2KB) — Không ảnh hưởng đáng kể đến bundle.
 * Lookup: O(1) nhờ sử dụng Set.
 */

const COMMON_WORDS_RAW = `
a,about,above,across,act,add,after,again,against,age,ago,agree,air,all,allow,
almost,along,already,also,always,among,an,and,animal,another,answer,any,appear,
apple,area,arm,around,art,as,ask,at,away,back,bad,bag,ball,bank,base,be,beat,
beautiful,because,become,bed,been,before,began,begin,behind,believe,below,
best,better,between,big,black,blood,blue,board,body,bone,book,born,both,
bottom,box,boy,break,bring,brother,brown,build,burn,bus,business,busy,but,
buy,by,call,came,can,car,card,care,carry,case,cat,catch,cause,center,certain,
chair,change,check,child,children,city,class,clean,clear,close,cold,color,
come,common,company,complete,computer,consider,cook,cool,corner,could,
country,course,cover,cross,cry,cup,cut,dad,dance,dark,daughter,day,dead,
dear,death,decide,deep,develop,did,die,different,dinner,direction,do,doctor,
does,dog,dollar,done,door,down,draw,dream,dress,drink,drive,drop,dry,during,
each,ear,early,earth,east,eat,education,egg,eight,either,else,end,energy,
engine,enough,enter,even,evening,ever,every,everyone,everything,example,
except,excited,exercise,expect,experience,explain,eye,face,fact,fall,family,
far,farm,fast,father,feel,feet,few,field,fight,fill,final,find,fine,finger,
finish,fire,first,fish,five,floor,fly,follow,food,foot,for,force,foreign,
forest,forget,form,found,four,free,friend,from,front,full,fun,future,game,
garden,gave,general,get,girl,give,glad,glass,go,god,gold,gone,good,got,
government,great,green,grew,ground,group,grow,guess,gun,guy,had,hair,half,
hall,hand,happen,happy,hard,has,hat,have,he,head,hear,heart,heat,heavy,held,
hello,help,her,here,herself,high,hill,him,himself,his,hit,hold,hole,home,
hope,horse,hospital,hot,hotel,hour,house,how,however,human,hundred,hungry,
hurry,hurt,husband,idea,if,important,in,include,information,inside,instead,
interest,into,island,it,its,job,join,joy,jump,just,keep,key,kid,kill,kind,
king,kitchen,knew,know,land,language,large,last,late,later,laugh,law,lay,
lead,learn,least,leave,led,left,leg,less,let,letter,level,life,light,like,
line,list,listen,little,live,long,look,lose,lost,lot,love,low,luck,lunch,
machine,made,main,make,man,many,map,mark,market,matter,may,maybe,me,mean,
meet,member,men,might,mile,million,mind,minute,miss,modern,mom,moment,money,
month,moon,more,morning,most,mother,mountain,mouth,move,movie,much,music,
must,my,myself,name,nation,nature,near,necessary,need,never,new,news,next,
nice,night,nine,no,none,nor,north,nose,not,note,nothing,notice,now,number,
of,off,offer,office,often,oh,oil,old,on,once,one,only,open,or,order,other,
our,out,outside,over,own,page,paint,pair,paper,parent,part,party,pass,past,
pay,people,perhaps,period,person,pick,picture,piece,place,plan,plant,play,
please,point,poor,position,possible,power,practice,prepare,present,president,
pretty,price,probably,problem,produce,product,program,provide,public,pull,
purpose,push,put,question,quick,quite,race,rain,raise,ran,rather,reach,read,
ready,real,reason,receive,record,red,remember,report,rest,result,return,rich,
ride,right,ring,rise,river,road,rock,role,room,round,rule,run,safe,said,same,
sat,save,saw,say,school,science,sea,season,seat,second,see,seem,sell,send,
serve,service,set,seven,several,shall,shape,share,she,ship,short,should,
show,shut,side,sign,simple,since,sing,sister,sit,situation,six,size,skin,
sleep,small,smell,smile,snow,so,social,some,someone,something,sometimes,son,
song,soon,sorry,sound,south,space,speak,special,spend,spoke,stand,star,
start,state,stay,step,still,stop,story,street,strong,student,study,such,
suddenly,suggest,summer,sun,support,sure,surprise,sweet,table,take,talk,tall,
teach,tell,ten,test,than,thank,that,the,their,them,then,there,these,they,
thing,think,third,this,those,though,thought,thousand,three,through,throw,
time,to,today,together,told,tomorrow,tonight,too,took,top,total,touch,
toward,town,trade,travel,tree,trouble,true,try,turn,twelve,twenty,two,type,
under,understand,unit,until,up,upon,us,use,usually,value,very,visit,voice,
wait,walk,wall,want,war,warm,was,wash,watch,water,way,we,wear,weather,
week,well,went,were,west,western,what,when,where,which,while,white,who,
whole,why,wide,wife,will,win,wind,window,winter,wish,with,without,woman,
women,wonder,word,work,world,worry,would,write,wrong,yard,yeah,year,yes,
yet,you,young,your
`.trim();

// Tạo Set cho lookup O(1)
const COMMON_WORDS = new Set(
    COMMON_WORDS_RAW.split(/[,\s]+/).map(w => w.trim().toLowerCase()).filter(Boolean)
);

/**
 * Kiểm tra xem một từ có nằm trong danh sách từ phổ biến không.
 * @param {string} word - Từ tiếng Anh cần kiểm tra
 * @returns {boolean} true nếu từ nằm trong top ~500 từ phổ biến
 */
export function isCommonWord(word) {
    if (!word) return false;
    return COMMON_WORDS.has(word.toLowerCase().replace(/[^a-z]/g, ''));
}

/**
 * Lấy kích thước từ điển (dùng cho debug/test)
 */
export function getDictionarySize() {
    return COMMON_WORDS.size;
}
