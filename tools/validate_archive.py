"""Validate a local recording ZIP without changing it or uploading data."""
import argparse
import csv
import io
import json
from pathlib import Path
import zipfile

def validate(path):
    with zipfile.ZipFile(path) as archive:
        expected = {'metadata.json','game_session.json','emg.csv','gaze.csv','pupil.csv','events.csv','trials.csv','README.txt'}
        assert set(archive.namelist()) == expected, 'Unexpected ZIP members'
        assert archive.testzip() is None, 'ZIP CRC error'
        metadata = json.loads(archive.read('metadata.json'))
        tables = {name:list(csv.DictReader(io.StringIO(archive.read(name+'.csv').decode('utf-8-sig')))) for name in ['emg','gaze','pupil','events','trials']}
        for name in ['emg','gaze','events','trials']:
            assert len(tables[name]) == metadata['counts'][name], f'{name} count mismatch'
        assert len(tables['pupil']) == metadata['pupil_rows'], 'Pupil count mismatch'
        assert metadata['pupil_available'] == bool(tables['pupil']), 'Pupil availability mismatch'
        for sample in tables['emg']:
            assert 0 <= int(sample['adc0']) <= 1023, 'ADC out of range'
            if metadata['simulated_emg']:
                assert sample['source'] in ['simulation','firmware_simulation'], 'Simulation incorrectly labelled'
            if metadata.get('format') == 'BN5213_UI_EMG_3':
                for field in ['filtered0','feature0','rate0','quality0']:
                    assert sample.get(field), f'Missing burst field: {field}'
                if sample.get('phase') != 'baseline':
                    assert sample.get('threshold0') and sample.get('rate_threshold0'), 'Missing calibrated threshold'
                assert float(sample['feature0']) >= 0 and float(sample['rate0']) >= 0, 'Negative burst feature'
        for trial in tables['trials']:
            if trial['confirmationType'] == 'gaze_only':
                assert not trial['emgOnsetPerfMs'] and not trial['emgSource'], 'Gaze-only trial contains EMG confirmation'
            if trial['confirmationType'] == 'emg' and trial['emgOnsetPerfMs']:
                assert float(trial['emgOnsetPerfMs']) >= float(trial['gazePerfMs']), 'EMG onset predates gaze'
                assert float(trial['emgConfirmedPerfMs']) >= float(trial['emgOnsetPerfMs']), 'Reversed EMG timestamps'
            if trial['validForTiming'] == 'false':
                assert trial['timingExclusion'], 'Missing exclusion reason'
            if trial['observerIntervalMs']:
                interval = float(trial['observerSeatedAt']) - float(trial['observerStandAt'])
                assert abs(interval-float(trial['observerIntervalMs'])) < 0.01, 'Observer interval mismatch'
            if trial.get('completionSource') == 'emg_activation':
                assert trial.get('standingVerified') == 'false', 'Activation must not claim verified standing'
                assert not trial['observerIntervalMs'], 'Automatic progression must not invent an observer interval'
        return {'archive':Path(path).name,'status':'PASS','condition':metadata['condition'],'simulated_emg':metadata['simulated_emg'],
            'fast_demo':metadata.get('fast_demo'),'game_status':metadata.get('game_status'),
            'rows':{name:len(rows) for name,rows in tables.items()},'trials_excluded_for_timing':sum(row['validForTiming']=='false' for row in tables['trials'])}

if __name__ == '__main__':
    parser=argparse.ArgumentParser();parser.add_argument('archive',type=Path);args=parser.parse_args()
    print(json.dumps(validate(args.archive),ensure_ascii=False,indent=2))
