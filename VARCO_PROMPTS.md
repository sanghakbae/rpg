# VARCO 3D 프롬프트 — 에테리아

## 사용법 (중요)

- **한 번에 한 줄씩만** 복사해서 넣는다. 이 파일 전체를 붙여넣으면 안 된다.
- 붙여넣는 곳: 좌측 메뉴 **이미지 스튜디오** → 화면 맨 아래 `만들고 싶은 이미지를 설명해 주세요` 입력창
- 설정: 비율 **1:1**, `3D 프롬프트` 토글 **ON**, 생성 장수 2~4장
- 마음에 드는 이미지가 나오면 → 좌측 **3D 생성** → `이미지` 탭에 업로드 → `3D 생성하기`
- 다듬기: **3D 스튜디오** → 리깅: **3D 애니메이션** → **GLB 내보내기**

---

## 영웅 4종

### 전사
```
chibi knight hero in crimson red plate armor with gold trim, steel helmet with open visor, holding a longsword, stylized low-poly game character, oversized head chunky proportions, flat cel-shaded colors, symmetric A-pose facing forward, full body visible, pure white background, no shadow, no ground plane, centered, orthographic front view
```

### 아처
```
chibi ranger hero in a green hooded cloak with a red feather, leather bracers, holding a wooden longbow, quiver on back, stylized low-poly game character, oversized head chunky proportions, flat cel-shaded colors, symmetric A-pose facing forward, full body visible, pure white background, no shadow, no ground plane, centered, orthographic front view
```

### 로그
```
chibi rogue hero in a dark hooded leather outfit with amber orange accents, face mask, twin daggers in both hands, stylized low-poly game character, oversized head chunky proportions, flat cel-shaded colors, symmetric A-pose facing forward, full body visible, pure white background, no shadow, no ground plane, centered, orthographic front view
```

### 마법사
```
chibi mage hero in a purple wizard robe with star pattern, tall pointed hat, holding a glowing crystal staff, stylized low-poly game character, oversized head chunky proportions, flat cel-shaded colors, symmetric A-pose facing forward, full body visible, pure white background, no shadow, no ground plane, centered, orthographic front view
```

---

## ★유니크(엘리트) 몬스터 6종

### ★슬라임
```
giant elite slime monster, dark emerald green translucent glossy blob, glowing core visible inside, two small dark eyes, cracked crystal shards floating around it, stylized low-poly game creature, flat cel-shaded colors, facing forward, full body visible, pure white background, no shadow, no ground plane, centered, orthographic front view
```

### ★고블린
```
elite goblin champion, olive green skin with red tribal war paint, long pointed ears, glowing crimson eyes, spiked bone pauldron, notched cleaver, snarling, stylized low-poly game creature, oversized head chunky proportions, flat cel-shaded colors, symmetric A-pose facing forward, full body visible, pure white background, no shadow, no ground plane, centered, orthographic front view
```

### ★늑대
```
alpha dire wolf, thick gray shaggy fur with battle scars, glowing red eyes, oversized white fangs, spiked iron collar, standing on four legs in side profile, stylized low-poly game creature, flat cel-shaded colors, full body visible, pure white background, no shadow, no ground plane, centered, orthographic side view
```

### ★스켈레톤
```
elite skeleton champion, bone white skull and ribcage with cracked bone armor plates, cyan soul flames in the eye sockets, jagged bone blade, tattered cloth wrap, stylized low-poly game creature, oversized skull chunky proportions, flat cel-shaded colors, symmetric A-pose facing forward, full body visible, pure white background, no shadow, no ground plane, centered, orthographic front view
```

### ★오크 (보스)
```
elite orc warlord, massive dark green muscular body, protruding tusks, iron war mask, spiked shoulder armor, trophy skulls on belt, heavy build, stylized low-poly game creature, oversized head chunky proportions, flat cel-shaded colors, symmetric A-pose facing forward, full body visible, pure white background, no shadow, no ground plane, centered, orthographic front view
```

### ★리치 (보스)
```
elite archlich sorcerer, tattered violet robe with floating torn banners, skeletal face inside the hood, glowing purple soul flames orbiting the skull, crown of bone shards, no legs the robe trails into mist, stylized low-poly game creature, flat cel-shaded colors, facing forward, full body visible, pure white background, no shadow, no ground plane, centered, orthographic front view
```

---

## 게임 팔레트 참고 (색이 어긋나면 프롬프트에 hex 추가)

| 대상 | 메인 | 셰이드 |
|---|---|---|
| 전사 | `#e74c3c` | — |
| 아처 | `#27ae60` | — |
| 로그 | `#f39c12` | — |
| 마법사 | `#9b59b6` | — |
| slime | `#2ecc71` | `#1e8449` |
| goblin | `#6da34d` | `#4f7a36` |
| wolf | `#9aa2a8` | `#6f777c` |
| skeleton | `#e8e4d8` | `#b8b4a8` |
| orc | `#5d8a41` | `#3f5c33` |
| lich | `#8b6bff` | `#5a3fd4` |

몬스터 26종은 위 **베이스 6종의 팔레트 스왑**이다 (slime→레드/서리/독/암흑, wolf→지옥견/서리늑대/몽마 등).
베이스만 만들면 나머지는 색 변경으로 커버되니 크레딧을 아낄 수 있다.

## 우선순위 — Free 2,000 크레딧 (현재 1,820 남음)

1. 영웅 4종 ← 항상 화면 중앙, 체감 가장 큼
2. ★슬라임 · ★고블린 · ★늑대 (가장 자주 마주치는 3종)
3. 나머지는 팔레트 스왑

## GLB 내보내기 규격

- 정면이 **-Z**, 발바닥이 **Y=0**
- 높이: 몬스터 ~1.6 / 보스(오크·리치) ~2.4 / 영웅 ~1.7 유닛
- 받으면 8방향 × (대기2 / 걷기4 / 공격3) 스프라이트 시트로 베이크해서 게임에 넣는다

## 라이선스 주의

Free 플랜은 **상업적 이용 불가**. 배포 중인 rpg.sanghak.kr 에 실제 반영하려면 Plus(월 22,000원) 이상 필요.
