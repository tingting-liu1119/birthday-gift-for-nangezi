export type GiftSpecialStar = {
  name: string;
  message: string[];
};

export type GiftConfig = {
  friendName: string;
  birthDate: string;
  targetDate: string;
  age?: string;
  greeting: string;
  message: string;
  letter: string[];
  signature: string;
  metDate?: string;
  musicUrl?: string;
  accent: string;
  cyan: string;
  pink: string;
  specialStar: GiftSpecialStar;
};

export const defaultGiftConfig: GiftConfig = {
  friendName: '南歌子',
  birthDate: '1995-10-29',
  targetDate: '2026-10-29T00:00:00+08:00',
  age: '31',
  greeting: '10月29日，星光会为你重新排列。',
  message: '这份生日祝福已经送达。',
  letter: [
    '生日快乐呀！',
    '又长大了一岁，恭喜你成功完成了新一轮的地球旅行！',
    '其实想说的祝福有很多，但仔细想想，好像也不必把未来的每一件事都许得十全十美。',
    '那就祝你，新的一岁，依旧拥有探索世界的好奇心，拥有奔赴热爱的勇气，也拥有面对生活中那些不如意的底气。',
    '希望你想做的事情都能慢慢有结果，期待的事情能在某个平常的日子悄悄发生。偶尔有好运降临，也常常能从不起眼的小事里收获快乐。',
    '不必事事顺遂，但愿事事值得。',
    '新的一岁，愿你自由、尽兴，活得像自己。',
  ],
  signature: 'From 听听',
  musicUrl: '/music/half-love-song.mp3',
  accent: '#a76bff',
  cyan: '#63f3ff',
  pink: '#ff5bd7',
  specialStar: {
    name: '南歌子的星星',
    message: [
      '咦，居然被你发现了！',
      '看来这颗星星还是藏得不够好。',
      '不过既然你已经找到这里，那就额外送你一个小小的祝福吧。',
      '宇宙这么大，人生这么长，还有数不清的风景等待你去遇见。',
      '希望你永远保有对未知的期待，也永远拥有重新出发的勇气。',
      '至于这颗星星嘛，就当作是今天的限定好运。',
      '生日快乐，幸运的地球居民！🌟',
    ],
  },
};
