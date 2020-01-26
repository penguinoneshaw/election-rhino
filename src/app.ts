import axios from 'axios-observable';
import { Observable, Observer } from 'rxjs';
import { map, concatAll, retry, scan, share, filter, mergeAll, toArray, last } from 'rxjs/operators';
import { isUndefined } from 'util';
import { promises as fs } from 'fs';
import { Party, VoteData, SeatAssignments, ElectionData, Election, Constituency } from './interfaces';
import { additiveMerge } from './util';

const democracyClubAxios = axios.create({
    baseURL: 'https://candidates.democracyclub.org.uk/api/next',
});

function getRegion(gssId: string): Regions {
    if (gssId.match(/E14/)) {
        return 'England';
    } else if (gssId.match(/W07/)) {
        return 'Wales';
    } else if (gssId.match(/S14/)) {
        return 'Scotland';
    } else {
        return 'Northern Ireland';
    }
}

type Regions = 'England' | 'Wales' | 'Scotland' | 'Northern Ireland';

interface ProcessedData {
    region: Regions;
    parties: Record<string, Party>;
    votes: VoteData;
    elected: Record<string, number>;
}

function maxKey<V>(obj: Record<string, V>): string {
    return Object.keys(obj).reduce((a, b) => (obj[a] > obj[b] ? a : b));
}

function dHondtDistribute(parties: VoteData, seats = 650): SeatAssignments {
    const seatAssignments: SeatAssignments = {};
    const workingVotes = { ...parties };
    for (const p of Object.keys(workingVotes)) {
        seatAssignments[p] = 0;
    }
    for (let i = 0; i < seats; i++) {
        const biggestKey = maxKey(workingVotes);
        seatAssignments[biggestKey] += 1;
        workingVotes[biggestKey] = parties[biggestKey] / (1 + seatAssignments[biggestKey]);
    }
    return seatAssignments;
}

function processProcessedData(data: Observable<ProcessedData>, filterValue?: Regions): Observable<ElectionData> {
    return data.pipe(
        filter(({ region }) => isUndefined(filterValue) || region == filterValue),
        scan(
            (acc, value, i) => ({
                votes: additiveMerge(acc.votes, value.votes),
                parties: Object.assign(acc.parties, value.parties),
                actualSeats: additiveMerge(acc.actualSeats, value.elected),
                seats: i + 1,
            }),
            {
                votes: {},
                parties: {},
                seats: 0,
                actualSeats: {},
            },
        ),
        map(v => ({
            ...v,
            dHondtSeats: dHondtDistribute(v.votes, v.seats),
            actualSeats: Object.keys(v.parties).reduce(
                (acc, next, _) => ({ ...acc, [next]: v.actualSeats[next] || 0 }),
                {},
            ),
        })),
    );
}

function getElectionData(ax: axios, election = 'parl.2019-12-12'): Observable<ProcessedData> {
    const electionsResponse = ax.get<Election>(`/elections/${election}/`);

    return electionsResponse.pipe(
        map(v => v.data.ballots.map(v => `/ballots/${v.ballot_paper_id}/`)),
        map(v => v.map(link => ax.get<Constituency>(link))),
        concatAll(),
        mergeAll(5),
        retry(3),
        map(v => v.data),
        map(v => {
            return {
                region: getRegion(v.post.id),
                parties: v.candidacies.reduce(
                    (acc, next) =>
                        next.party.ec_id !== 'ynmp-party:2'
                            ? { ...acc, [next.party.ec_id]: next.party }
                            : { ...acc, [next.person.id]: next.person },
                    {},
                ),
                elected: v.candidacies.reduce((acc, next) => {
                    if (!next.result.elected) return acc;
                    const party = next.party.ec_id !== 'ynmp-party:2' ? next.party.ec_id : next.person.id;

                    const curSeats = acc[party] || 0;
                    return { ...acc, [party]: curSeats + 1 };
                }, {}),
                votes: v.candidacies.reduce(
                    (ballots, nextBallot) =>
                        nextBallot.party.ec_id !== 'ynmp-party:2'
                            ? {
                                  ...ballots,
                                  [nextBallot.party.ec_id]: nextBallot.result.num_ballots,
                              }
                            : {
                                  ...ballots,
                                  [nextBallot.person.id]: nextBallot.result.num_ballots,
                              },
                    {},
                ),
            };
        }),
        share(),
    );
}

const data$ = getElectionData(democracyClubAxios);

const displayObserver: Observer<Record<string, ElectionData & { misrepresentationError: number }>> = {
    next: v => {
        const csv =
            'party,votes,dHondt,actual,misrepError\n' +
            Object.entries(v)
                .map(([party, data]) =>
                    [party, data.votes, data.dHondtSeats, data.actualSeats, data.misrepresentationError].join(','),
                )
                .join('\n');
        console.log(csv);
    },
    error: v => console.error(v),
    complete: () => console.log('DONE'),
};
data$.pipe(toArray()).subscribe({
    next: async data => {
        const fd = await fs.open('data/constituencies.json', 'w');
        await fd.write(JSON.stringify(data, null, 4));
        await fd.close();
    },
});

function aggregateData(data: ElectionData): Record<string, ElectionData & { misrepresentationError: number }> {
    return Object.keys(data.parties).reduce(
        (acc, value) => ({
            ...acc,
            [data.parties[value].name]: {
                dHondtSeats: data.dHondtSeats[value],
                votes: data.votes[value],
                actualSeats: data.actualSeats[value],
                misrepresentationError: (data.actualSeats[value] - data.dHondtSeats[value]) / data.seats,
            },
        }),
        {},
    );
}

//processProcessedData(data$, 'England').subscribe(displayObserver);
processProcessedData(data$, 'Scotland')
    .pipe(map(aggregateData))
    .pipe(last())
    .subscribe(displayObserver);

processProcessedData(data$, 'England')
    .pipe(map(aggregateData))
    .pipe(last())
    .subscribe(displayObserver);
