export interface Election {
    slug: string;
    url: string;
    name: string;
    election_date: string;
    current: boolean;
    organisation: {
        url: string;
        name: string;
        slug: string;
    };
    ballots: [
        {
            url: string;
            ballot_paper_id: string;
        },
    ];
}

export interface Person {
    id: string;
    url: string;
    name: string;
}

export interface Party {
    url: string;
    ec_id: string;
    name: string;
}

export interface Ballot {
    person: Person;
    party: Party;
    result: {
        num_ballots: number;
        elected?: boolean;
    };
}

export interface Post {
    id: string;
}

export interface Constituency {
    post: Post;
    candidacies: Ballot[];
}

export interface VoteData {
    [party: string]: number;
}

export interface SeatAssignments {
    [party: string]: number;
}

export interface ElectionData {
    votes: VoteData;
    parties: Record<string, Party>;
    dHondtSeats: SeatAssignments;
    actualSeats: SeatAssignments;
    seats: number;
}
