import { print } from 'gluegun/print';

// http://146.190.238.87:30120/info.json


export const splitLines = (text: string) => text.split('\n');
export const splitLine = (row: string) => row.split(/\s+/);
export const parse = (data: string, formatter: Function) => {
    splitLines(data).map((line) => {
        return formatter(splitLine(line))
    })
};

