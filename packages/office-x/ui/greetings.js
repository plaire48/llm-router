// Device-local time. A greeting stays still while the user reads or signs in.
export const greetingGroups = [
  {id:'morning',label:'아침',start:5,end:11,messages:[
    '당신의 아침이 가벼웠으면 해요',
    '오늘은 좋은 순간이 많기를',
    '새로운 하루를 함께 열어요',
    '작은 시작도 충분히 소중해요',
    '당신의 속도로 시작해도 좋아요',
    '오늘의 당신을 응원해요',
    '마음에 햇살이 드는 아침이길',
    '첫걸음은 가볍게 내디뎌요',
    '오늘도 반가워요',
    '어제와 다른 오늘을 만나봐요',
  ]},
  {id:'midday',label:'점심',start:11,end:14,messages:[
    '오전의 수고에 박수를 보내요',
    '잠깐의 여유도 당신의 몫이에요',
    '점심만큼은 편안한 시간이길',
    '바쁜 하루에도 웃을 틈이 있기를',
    '작은 즐거움 하나 챙겨봐요',
    '한숨 돌리고 다시 만나요',
    '따뜻한 한 끼가 힘이 되기를',
    '오늘의 절반을 함께 걸어요',
    '창밖을 볼 여유가 생기길',
    '잠깐 쉬어가도 괜찮아요',
  ]},
  {id:'afternoon',label:'오후',start:14,end:18,messages:[
    '오후의 걸음은 조금 가볍게',
    '복잡한 일은 함께 풀어봐요',
    '작은 진전도 분명한 한 걸음이에요',
    '당신의 정성은 일에 남아요',
    '잘 풀리는 순간이 찾아오기를',
    '서두르지 않아도 괜찮아요',
    '남은 하루에 좋은 소식이 있기를',
    '애쓴 마음도 잠시 챙겨주세요',
    '혼자 다 해내지 않아도 돼요',
    '오늘의 노력이 내일을 돕기를',
  ]},
  {id:'evening',label:'저녁',start:18,end:22,messages:[
    '오늘 하루도 수고 많았어요',
    '저녁은 당신에게 다정했으면 해요',
    '오늘의 당신에게 고마워해 주세요',
    '작은 마무리 뒤에 여유가 있기를',
    '애쓴 만큼 편히 쉴 수 있기를',
    '좋았던 순간 하나 간직해요',
    '하루의 끝이 따뜻했으면 해요',
    '남은 일은 차분히 정리해요',
    '오늘도 당신의 자리를 지켰네요',
    '이제 당신을 위한 시간도 챙겨요',
  ]},
  {id:'night',label:'밤과 새벽',start:22,end:5,messages:[
    '늦은 시간에도 반가워요',
    '오늘의 무게를 조금 내려놓아요',
    '조용한 밤이 위로가 되기를',
    '완벽하지 않은 하루도 괜찮아요',
    '내일의 당신에게 맡겨도 좋아요',
    '마음만은 편안한 밤이길',
    '여기까지 온 당신, 수고했어요',
    '늦은 만큼 천천히 해도 좋아요',
    '잠시 눈을 쉬어도 괜찮아요',
    '오늘보다 다정한 내일이 오기를',
  ]},
];
export function greetingPeriod(date=new Date()) {
  const hour=date.getHours();
  return greetingGroups.find(g=>g.start<g.end?hour>=g.start&&hour<g.end:hour>=g.start||hour<g.end);
}
export function chooseGreeting(date=new Date(),previousId='',random=Math.random) {
  const group=greetingPeriod(date);
  const choices=group.messages.map((text,index)=>({id:`${group.id}-${index}`,period:group.id,text})).filter(item=>item.id!==previousId);
  return choices[Math.floor(random()*choices.length)];
}
