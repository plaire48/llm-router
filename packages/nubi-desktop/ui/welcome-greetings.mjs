// Local time only. Keep one greeting while composing; choose again on new chat.
export const WELCOME_GREETINGS = [
  {until:6,lines:[
    '고요한 시간, 반가워요.',
    '천천히 이야기해 주세요.',
    '복잡한 생각, 함께 풀어요.',
    '서두르지 않아도 괜찮아요.',
    '작은 일부터 함께해요.',
  ]},
  {until:12,lines:[
    '좋은 아침, 반가워요.',
    '오늘도 함께 시작해요.',
    '가벼운 마음으로 시작해요.',
    '오늘의 첫걸음, 함께해요.',
    '차근차근 시작해 볼까요?',
  ]},
  {until:14,lines:[
    '오전도 애쓰셨어요.',
    '잠깐 숨을 돌려도 좋아요.',
    '남은 하루도 함께해요.',
    '오후는 조금 가볍게 가요.',
    '다시 만나 반가워요.',
  ]},
  {until:18,lines:[
    '복잡한 일, 나눠서 해요.',
    '정리가 안 돼도 괜찮아요.',
    '막힌 곳부터 함께 풀어요.',
    '잠깐 쉬어 가도 괜찮아요.',
    '작은 고민도 들려주세요.',
  ]},
  {until:22,lines:[
    '오늘도 애쓰셨어요.',
    '하루 끝에 만나 반가워요.',
    '남은 일은 가볍게 나눠요.',
    '천천히 마무리해 볼까요?',
    '마음에 남은 일, 함께 봐요.',
  ]},
  {until:24,lines:[
    '늦은 시간, 반가워요.',
    '오늘 하루도 수고했어요.',
    '서두르지 말고 함께해요.',
    '내일 할 일, 같이 정리해요.',
    '편하게 이야기해 주세요.',
  ]},
];
export function welcomeGreeting({date=new Date(),previous='',random=Math.random}={}) {
  const lines=WELCOME_GREETINGS.find(period=>date.getHours()<period.until).lines;
  const choices=lines.filter(line=>line!==previous);
  return choices[Math.min(choices.length-1,Math.max(0,Math.floor(random()*choices.length)))];
}
