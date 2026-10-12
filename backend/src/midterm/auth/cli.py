"""Interactive operator-only account bootstrap and password recovery."""
import getpass
import os
from pathlib import Path
from .store import AccessError, AccessStore


def run(command):
    path = os.getenv('GENFORECAST_ACCESS_DB') or str(Path(__file__).resolve().parents[3] / 'data' / 'access.sqlite3')
    store = AccessStore(path)
    if command == 'init' and store.initialized():
        raise SystemExit('관리자가 이미 설정되어 있습니다. 비밀번호 복구는 admin reset-password를 사용하세요.')
    username = input('아이디: ')
    name = input('표시 이름: ') if command == 'init' else None
    password = getpass.getpass('비밀번호 (8~128자): ')
    confirm = getpass.getpass('비밀번호 확인: ')
    if password != confirm:
        raise SystemExit('비밀번호가 일치하지 않습니다. 변경하지 않았습니다.')
    try:
        if command == 'init':
            store.init_admin(username, name, password)
            print('최초 관리자 생성 완료. 웹앱에서 로그인하세요.')
        else:
            store.reset_password(username, password)
            print('임시 비밀번호 설정 완료. 기존 세션은 폐기되었으며 다음 로그인에서 비밀번호를 변경해야 합니다.')
    except AccessError as error:
        raise SystemExit(str(error)) from None
