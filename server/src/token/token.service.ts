import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Nonce } from './schemas/token.schema';
import axios from 'axios';
import 'dotenv/config';
import { Cron } from '@nestjs/schedule';
import { KlaytnService } from 'src/klaytn/klaytn.service';
import { BuyTokenDto } from './dto/buy-token.dto';
import { EntryTokenDto } from './dto/entry-token.dto';
import { EventStatus, EventStatusDocument } from 'src/event/schemas/event-status.schema';
import { HoldingType } from './schemas/holding.schema';
import { Participant, ParticipantDocument } from './schemas/participant.schema';
import { BalanceDto } from './dto/balance.dto';
import { Event } from '../event/schemas/event.schema';

const OWNER_ADDRESS = process.env.OWNER_ADDRESS.toLowerCase();

@Injectable()
export class TokenService {
  constructor(
    @InjectModel('Nonce') private readonly NonceModel: Model<Nonce>,
    @InjectModel('Holding') private readonly HoldingModel: Model<HoldingType>,
    @InjectModel('Event') private readonly EventModel: Model<Event>,
    @InjectModel(EventStatus.name) private readonly EventStatusModel: Model<EventStatusDocument>,
    @InjectModel(Participant.name) private readonly ParticipantModel: Model<ParticipantDocument>,
    private readonly klaytnService: KlaytnService,
  ) {}

  // 주소에 따른 token 목록 반환 함수
  async findTokenList(_address: string) {
    console.log('findTokenList');
    //주소가 보유하고 있는 token List를 DB에서 호출
    try {
      const tokenList = await this.HoldingModel.find({ address: _address });
      console.log('res:', tokenList);
      if (tokenList.length <= 0) {
        return { message: 'no data' };
      }
      console.log('result', tokenList);
      return tokenList;
    } catch (e) {
      console.log(e);
      return { message: 'Fail findTokenList' };
    }
  }

  // 주소와 token_id로 QR code 생성 및 nonce 발행하는 함수
  async createTokenQR(address: string, token_id: number) {
    console.log('createTokenQR');
    //유효한 계정(로그인)일 경우, 받은 주소에 해당 토큰 확인 (이 부분은 나중에 다른 데이터 확인해야함 Nonce X)
    // 계정(로그인) 확인 코드 필요
    try {
      // let saveResult;
      const holdingdata = await this.HoldingModel.findOne({
        address: `${address}`,
        token_id: `${token_id}`,
      }).exec();
      //해당 주소가 없거나 주소에 토큰이 없으면 종료
      console.log('holdingsdata:', holdingdata);
      if (holdingdata === null) {
        return { message: 'address or token_id is not invalid' };
      }
      // 토큰을 가지고 있다면 nonce 발행 기록이 있는지 확인
      const noncedata = await this.NonceModel.findOne({
        address: `${address}`,
        token_id: `${token_id}`,
        event_id: `${holdingdata.event_id}`,
      }).exec();

      const now = new Date(); // 현재 날짜
      const ex = Math.round(Number(now.getTime() / 1000)) + 25; //유효기한 10초
      console.log('ex', ex);
      //만약 한 번도 nonce 발행 기록이 없다면 새로 발행
      if (noncedata !== null) {
        console.log('기존 QR 삭제');
        //nonce값 생성, DB에 논스값 저장
        const deleteRes = await this.NonceModel.deleteOne({
          address: `${address}`,
          token_id: `${token_id}`,
          event_id: `${holdingdata.event_id}`,
        });
        console.log('delete:', deleteRes);
      }
      console.log('QR 발행');
      const newNonce = new this.NonceModel({
        address,
        token_id,
        date: ex,
        event_id: holdingdata.event_id,
      });
      const saveResult = await newNonce.save();
      //QR 생성 요청 API
      //참고 사이트 https://www.qr-code-generator.com/qr-code-api/?target=api-ad
      const nonce = saveResult._id; //nonce값은 무작이로 정해지는 _id값을 사용
      const text = `${nonce} format:(nonce)`;
      const api = process.env.QR_API_KEY;
      const param = {
        frame_name: 'no-frame',
        qr_code_text: text,
        image_format: 'SVG',
        image_width: 100,
      };
      //address와 token_id로 qrcode 생성
      const qr = await axios
        .post(`https://api.qr-code-generator.com/v1/create?access-token=${api}`, param)
        .then((res) => {
          return res.data;
        });
      console.log('발행 완료');
      return qr;
    } catch (e) {
      console.log(e);
      return { message: 'Fail to create QRcode ' };
    }
  }

  // QR 코드 생성시 발행한 nonce 값의 유효성 검사 함수
  async checkValidation(nonce: string, event_id: number) {
    console.log('checkValidation');
    //nonce가 유효한지 DB를 통해 확인
    console.log('value:', nonce);
    // console.log('hvalue:' nonce.Hex)
    console.log('event_id:', event_id);
    try {
      const validationNonce = await this.NonceModel.find({ _id: nonce, event_id: event_id }).exec();
      console.log('validationNonce', validationNonce);
      if (validationNonce.length < 1) {
        return new Error('해당하는 nonce 데이터가 없습니다.');
      }
      //해당 nonce의 유효기한이 남았는지 확인
      const valResult = this.checkEx(Number(validationNonce[0].date));

      let message: string;
      valResult ? (message = '유효한 QR') : (message = '유효하지 않은 QR');

      const nonceValidation = {
        message,
      };
      return nonceValidation;
    } catch (e) {
      console.log(e);
      return { message: 'Fail validation test' };
    }
  }

  // nonce의 유효기한이 남았는지 검사
  checkEx(date: number): boolean {
    try {
      const now = new Date(); // 현재 날짜
      const now_min = Math.round(now.getTime() / 1000);
      console.log('지금 시간', now_min);
      console.log('date:', date, 'now:', now_min, '유효기한(양수: 유효기한 남음):', date - now_min);
      if (Number(date) > now_min) {
        return true; // 유효기한 남음
      } else {
        return false; // 유효기한 지남
      }
    } catch (e) {
      console.log(e);
      return false;
    }
  }
  // 토큰 구매
  async buyToken(buyTokenDto: BuyTokenDto, user): Promise<string> {
    const eventId = buyTokenDto.event_id;
    const eventClassId = buyTokenDto.class_id;
    const number = buyTokenDto.number;

    try {
      const err = await this.klaytnService.buyToken(user.address, eventId, eventClassId, number);
      if (err) throw new Error('구매를 실패했습니다.');
      await this.EventModel.updateOne(
        { event_id: buyTokenDto.event_id },
        { $inc: { remaining: -1 } },
      );
      return '정상적으로 구매되었습니다.';
    } catch (error) {
      console.error(error);
      return '구매를 실패했습니다.';
    }
  }

  // 토큰 구매자 조회
  async getTokenHolders(eventId: number) {
    try {
      return await this.klaytnService.getTokenHolders(eventId);
    } catch (error) {
      console.error(error);
    }
  }

  // 토큰 응모
  async entryToken(entryTokenDto: EntryTokenDto, user): Promise<string> {
    const eventId = entryTokenDto.event_id;

    try {
      const err = await this.klaytnService.applyToken(user.address, eventId);
      if (err) throw new Error('응모에 실패했습니다.');
      return '정상적으로 응모되었습니다.';
    } catch (error) {
      console.error(error);
      return '응모에 실패했습니다.';
    }
  }

  // 잔액 조회
  async getBalance(address: string): Promise<BalanceDto> {
    const balanceDto: BalanceDto = new BalanceDto();
    const balance = await this.klaytnService.balanceOf(address);

    balanceDto.setAddress(address);
    balanceDto.setBalance(balance);

    return balanceDto;
  }

  // 사용자 address의 토큰을 읽어 오는 함수 - 매 초 실행
  @Cron('*/15 * * * * *')
  async getHoldingData() {
    console.log('getHoldingData : address에 따른 토큰 정보 받기');
    // // 'selling'
    // const sellingEventStatus = await this.EventStatusModel.find({ status: 'selling' }).exec();
    // for (let i = 0; i < sellingEventStatus.length; i++) {
    //   const eventId = sellingEventStatus[i].get('event_id');
    //   // console.log('eventId :', eventId);
    //   const eventTokenBuyers = await this.klaytnService.getTokenHolders(eventId);
    //   for (let j = 0; j < eventTokenBuyers.length; j++) {
    //     if (eventTokenBuyers[j].address === '0x0000000000000000000000000000000000000000') continue;
    //     const holder = await this.HoldingModel.findOne({
    //       token_id: eventTokenBuyers[j].token_id,
    //     }).exec();
    //     // console.log(!holder);
    //     if (!holder) {
    //       const newHolder = new this.HoldingModel(eventTokenBuyers[j]);
    //       await newHolder.save();
    //     } else {
    //       await holder.$set('address', eventTokenBuyers[j].address).save();
    //     }
    //   }
    // }
    // 'applying'
    console.log('응모자 조회 시작');
    const applyingEventStatus = await this.EventStatusModel.find({ status: 'applying' }).exec();
    for (let i = 0; i < applyingEventStatus.length; i++) {
      const eventId = applyingEventStatus[i].get('event_id');
      const eventParticipants = await this.klaytnService.getEventParticipants(eventId);
      if (eventParticipants.length === 0) continue;
      console.log('eventParticipants', eventId, ':', eventParticipants);
      const eventParticipantsCount = await this.ParticipantModel.find({
        event_id: eventId,
      })
        .count()
        .exec();
      const participantSchemas = eventParticipants.slice(eventParticipantsCount);
      if (participantSchemas.length === 0) continue;
      const participants = participantSchemas.map((address) => ({
        event_id: eventId,
        address,
      }));
      // console.log('participantSchemas :', participantSchemas);
      await this.ParticipantModel.create(participants);
    }
    console.log('응모자 조회 종료');
    // // 'end' - 이벤트 종료 후 토큰 거래

    console.log('구매자 조회 시작');
    const getTokensData = await this.klaytnService.getTokens('');
    if (getTokensData.message || !getTokensData.items) throw new Error(getTokensData.message);
    const tokens = getTokensData.items.filter((item) => item.owner !== OWNER_ADDRESS);
    console.log('token 개수 :', tokens.length);
    for (let i = 0; i < tokens.length; i++) {
      const tokenId = parseInt(tokens[i].tokenId, 16);
      const owner = tokens[i].owner.toLowerCase();
      const holding = await this.HoldingModel.findOne({ token_id: tokenId }).exec();
      if (!holding) {
        const eventId = await this.klaytnService.eventOf(tokenId);
        const holdingData = new this.HoldingModel({
          event_id: eventId,
          token_id: tokenId,
          address: owner,
        });
        await holdingData.save();
      } else {
        await this.HoldingModel.updateOne(
          { token_id: tokenId },
          { $set: { address: owner } },
        ).exec();
      }
    }
    console.log('구매자 조회 시작');

    await this.HoldingModel.deleteMany({ address: OWNER_ADDRESS }).exec();

    console.log('getHoldingData 업데이트 완료!');
  }

  @Cron('*/5 * * * * *')
  async test(): Promise<void> {
    await this.klaytnService.test();
  }
}
