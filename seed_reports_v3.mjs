import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
const prisma = new PrismaClient();

const defaultData = {
  year: 2026,
  weekNum: 12,
  assignments: [
    {
      name: "허주희",
      reports: [
        {
          major: "서비스",
          middle: "전자결재",
          current: [
            { id: uuidv4(), type: "sub", subText: "운영 대응 및 테스트", bullets: [{ id: uuidv4(), text: "에디터, 시행 관련 수정진행" }] }
          ],
          next: [
            { id: uuidv4(), type: "sub", subText: "운영 대응 및 테스트", bullets: [{ id: uuidv4(), text: "에디터, 시행 관련 수정테스트" }] }
          ]
        },
        {
          major: "제휴",
          middle: "하이웍스",
          current: [
            { id: uuidv4(), type: "sub", subText: "가비아 문의, 운영 대응", bullets: [] }
          ],
          next: [
            { id: uuidv4(), type: "sub", subText: "가비아 문의, 운영 대응", bullets: [] },
            { id: uuidv4(), type: "sub", subText: "역방향 연동 정책 정리 중 (파로스 -> 하이웍스)", bullets: [] }
          ]
        }
      ]
    },
    {
      name: "윤난희",
      reports: [
        {
          major: "서비스",
          middle: "근태관리",
          current: [
            { id: uuidv4(), type: "sub", subText: "개발대응", bullets: [{ id: uuidv4(), text: "연동 결재 양식 화면 기획" }] }
          ],
          next: [
            { id: uuidv4(), type: "sub", subText: "전자결재 연동 개발 진행 예정", bullets: [] },
            { id: uuidv4(), type: "sub", subText: "개발대응", bullets: [] }
          ]
        },
        {
          major: "서비스",
          middle: "전자계약",
          current: [
            { id: uuidv4(), type: "sub", subText: "전자계약 개발대응", bullets: [] },
            { id: uuidv4(), type: "sub", subText: "전자계약 약관초안 공유", bullets: [] },
            { id: uuidv4(), type: "sub", subText: "메일템플릿 수정", bullets: [
              { id: uuidv4(), text: "알림톡 채널 및 템플릿 생성 필요하나, 우선 파로스 템플릿으로 진행" }
            ] }
          ],
          next: [
            { id: uuidv4(), type: "sub", subText: "개발대응", bullets: [] },
            { id: uuidv4(), type: "sub", subText: "약관보완작업", bullets: [] }
          ]
        }
      ]
    },
    {
      name: "박종민",
      reports: [
        {
          major: "서비스",
          middle: "근태관리",
          current: [
            { id: uuidv4(), type: "sub", subText: "근태관리 수정/추가 기획", bullets: [] },
            { id: uuidv4(), type: "sub", subText: "전자결재 연동 관련 정리 완료", bullets: [
              { id: uuidv4(), text: "전자결재 코드/서식관리 등" }
            ] }
          ],
          next: [
            { id: uuidv4(), type: "sub", subText: "근태관리 수정/추가 기획", bullets: [] }
          ]
        }
      ]
    },
    {
      name: "구자영",
      reports: [
        {
          major: "서비스",
          middle: "Anchor",
          current: [
            { id: uuidv4(), type: "sub", subText: "개발대응 상시", bullets: [] },
            { id: uuidv4(), type: "sub", subText: "생산실적 재공계산 로직 및 회계전표처리 기획(계속)", bullets: [
              { id: uuidv4(), text: "실적입력 별 재공금액 계산 및 회계처리 정의" },
              { id: uuidv4(), text: "고정비 인식관련 회계기준 스터디" },
              { id: uuidv4(), text: "불량수량관련 회계처리 내용 추가" }
            ] },
            { id: uuidv4(), type: "sub", subText: "불량코드 수정", bullets: [
              { id: uuidv4(), text: "기준정보 수정, 생산실적 보고서 수정" }
            ] }
          ],
          next: [
            { id: uuidv4(), type: "sub", subText: "개발대응 상시", bullets: [] },
            { id: uuidv4(), type: "sub", subText: "생산실적 재공계산 로직 기획완료", bullets: [] }
          ]
        },
        {
          major: "제휴",
          middle: "AT, 한국공인회계사회",
          current: [
            { id: uuidv4(), type: "sub", subText: "인사·급여 AT 시험(TAT 2급) 대응 요건 개발 대응", bullets: [] },
            { id: uuidv4(), type: "sub", subText: "현금적요 추가 기획 및 개발대응", bullets: [] }
          ],
          next: [
            { id: uuidv4(), type: "sub", subText: "인사·급여 AT 시험 요건 개발 대응", bullets: [] }
          ]
        }
      ]
    },
    {
      name: "방수진",
      reports: [
        {
          major: "제휴",
          middle: "AT, 한국공인회계사회",
          current: [
            { id: uuidv4(), type: "sub", text: "표준재무제표 코드집 작성 및 개발대응", bullets: [] }
          ],
          next: [
            { id: uuidv4(), type: "sub", text: "현금적요, 표준재무코드 기획내용 정의", bullets: [] }
          ]
        },
        {
          major: "제휴",
          middle: "삼일회계법인",
          current: [
            { id: uuidv4(), type: "sub", text: "지방소득세특별징수납부서", bullets: [{ id: uuidv4(), text: "납부서 화면설계서 작성" }] }
          ],
          next: [
            { id: uuidv4(), type: "sub", text: "지방소득세특별징수납부서", bullets: [
              { id: uuidv4(), text: "납부서 화면설계서 작성 완료" },
              { id: uuidv4(), text: "WBS 작성" }
            ] }
          ]
        }
      ]
    }
  ]
};

async function main() {
  await prisma.summaryData.deleteMany({});
  await prisma.reportItem.deleteMany({});
  await prisma.report.deleteMany({});
  
  for (const userAss of defaultData.assignments) {
    let user = await prisma.user.findFirst({ where: { name: userAss.name } });
    if (!user) {
      user = await prisma.user.create({ data: { name: userAss.name } });
    }

    const report = await prisma.report.create({
      data: { userId: user.id, year: defaultData.year, weekNum: defaultData.weekNum }
    });

    for (const item of userAss.reports) {
      const cat = await prisma.category.findFirst({ where: { major: item.major, middle: item.middle } });
      if (cat) {
        await prisma.reportItem.create({
          data: {
            reportId: report.id,
            categoryId: cat.id,
            currentContents: JSON.stringify(item.current),
            nextContents: JSON.stringify(item.next)
          }
        });
      }
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
